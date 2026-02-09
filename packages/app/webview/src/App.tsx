import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type Viewport
} from '@xyflow/react'
import type { ProjectionNode, ProjectionState } from '../../src/projection-state.js'
import {
  parseExtensionToPanelMessage,
  type PanelToExtensionMessage
} from '../../src/panel-contract.js'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './components/ui/dropdown-menu'
import { Input } from './components/ui/input'
import { toGraphLayout, type GraphNode } from './lib/graph'
import {
  computeVisibleNodes,
  DEFAULT_STATUS_FILTER,
  toCompactPriorityNodes,
  type NodeSortKey,
  type NodeStatusFilter
} from './lib/view-model'
import { cn } from './lib/utils'

type LayoutDirection = 'topDown' | 'leftRight'

type PanelAppProps = {
  initialState: ProjectionState
  postMessage: (message: PanelToExtensionMessage) => void
}

const statusToBadgeVariant = (
  statusKind: ProjectionNode['statusKind']
): 'default' | 'success' | 'error' | 'warning' | 'info' => {
  if (statusKind === 'error') {
    return 'error'
  }

  if (statusKind === 'sorry') {
    return 'warning'
  }

  if (statusKind === 'in_progress') {
    return 'info'
  }

  if (statusKind === 'resolved') {
    return 'success'
  }

  return 'default'
}

const progressPercent = (total: number, resolved: number): number => {
  if (total <= 0) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round((resolved / total) * 100)))
}

const ProofNodeCard = ({ data }: NodeProps<Node>) => {
  const node = data as GraphNode
  const statusVariant = statusToBadgeVariant(node.statusKind)

  return (
    <div
      className={cn(
        'w-64 rounded-lg border p-3 text-xs shadow-md transition-colors',
        node.selected && 'border-sky-400 bg-slate-900/95',
        !node.selected && 'border-slate-700 bg-slate-950/90',
        node.cursor && 'ring-2 ring-amber-400/70'
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="truncate text-sm font-semibold text-slate-100">{node.label || node.id}</div>
        <Badge variant={statusVariant}>{node.statusKind}</Badge>
      </div>
      <div className="text-slate-400">{node.kind} · line {node.startLine}-{node.endLine}</div>
      {node.errorCategory && <div className="mt-1 truncate text-rose-300">{node.errorCategory}</div>}
    </div>
  )
}

const nodeTypes = {
  proofNode: ProofNodeCard
}

export function App({ initialState, postMessage }: PanelAppProps) {
  const [projection, setProjection] = useState<ProjectionState>(initialState)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<NodeSortKey>('position')
  const [statusFilter, setStatusFilter] = useState<NodeStatusFilter>(DEFAULT_STATUS_FILTER)
  const [hideResolved, setHideResolved] = useState(false)
  const [layout, setLayout] = useState<LayoutDirection>('topDown')
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })

  useEffect(() => {
    const handler = (event: MessageEvent<unknown>) => {
      const message = parseExtensionToPanelMessage(event.data)
      if (!message || message.type !== 'stateUpdate') {
        return
      }

      setProjection(message.payload)
    }

    window.addEventListener('message', handler)
    return () => {
      window.removeEventListener('message', handler)
    }
  }, [])

  const visibleNodes = useMemo(() => computeVisibleNodes({
    nodes: projection.nodes,
    query,
    statusFilter,
    sortKey,
    hideResolved
  }), [projection.nodes, query, statusFilter, sortKey, hideResolved])

  const graph = useMemo(() => toGraphLayout({
    nodes: visibleNodes,
    layout,
    selectedNodeId: projection.selectedNode?.id ?? null,
    cursorNodeId: projection.ui.cursorNodeId
  }), [visibleNodes, layout, projection.selectedNode?.id, projection.ui.cursorNodeId])

  const compactNodes = useMemo(() => toCompactPriorityNodes(visibleNodes, 24), [visibleNodes])

  const flowNodes = useMemo<Array<Node>>(() => graph.nodes.map((node) => ({
    id: node.id,
    position: { x: node.x, y: node.y },
    data: node,
    type: 'proofNode',
    draggable: false,
    selectable: true,
    deletable: false,
    connectable: false
  })), [graph.nodes])

  const flowEdges = useMemo<Array<Edge>>(() => graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed }
  })), [graph.edges])

  const send = useCallback((message: PanelToExtensionMessage) => {
    postMessage(message)
  }, [postMessage])

  const onNodeSelect = useCallback((nodeId: string) => {
    send({
      type: 'nodeClick',
      payload: { nodeId }
    })
  }, [send])

  const progress = projection.progress
  const percent = progress ? progressPercent(progress.totalGoals, progress.resolvedGoals) : 0

  return (
    <div className="flex min-h-full flex-col gap-3 bg-[#0a1019] px-3 py-3 text-slate-100">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>ProofFlow</CardTitle>
          <CardDescription>
            {projection.ui.activeFileUri
              ? `file: ${projection.ui.activeFileUri}`
              : 'No active Lean file'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge>{progress?.resolvedGoals ?? 0}/{progress?.totalGoals ?? 0} goals ({percent}%)</Badge>
            <Badge variant="error">errors: {progress?.blockedGoals ?? 0}</Badge>
            <Badge variant="warning">sorries: {progress?.sorryGoals ?? 0}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="mb-3 flex items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search node label/id/error/goal"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">View</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Layout</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={layout} onValueChange={(value) => setLayout(value as LayoutDirection)}>
                  <DropdownMenuRadioItem value="topDown">Top down</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="leftRight">Left right</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={hideResolved}
                  onCheckedChange={(checked) => setHideResolved(checked === true)}
                >
                  Hide resolved
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Sort</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={sortKey} onValueChange={(value) => setSortKey(value as NodeSortKey)}>
                  <DropdownMenuRadioItem value="position">Position</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="label">Label</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Status filter</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={statusFilter.error}
                  onCheckedChange={(checked) => {
                    setStatusFilter((prev) => ({ ...prev, error: checked === true }))
                  }}
                >
                  error
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={statusFilter.sorry}
                  onCheckedChange={(checked) => {
                    setStatusFilter((prev) => ({ ...prev, sorry: checked === true }))
                  }}
                >
                  sorry
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={statusFilter.in_progress}
                  onCheckedChange={(checked) => {
                    setStatusFilter((prev) => ({ ...prev, in_progress: checked === true }))
                  }}
                >
                  in-progress
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={statusFilter.resolved}
                  onCheckedChange={(checked) => {
                    setStatusFilter((prev) => ({ ...prev, resolved: checked === true }))
                  }}
                >
                  resolved
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={() => send({ type: 'togglePanel' })}>Hide</Button>
          </div>

          <div className="rounded-md border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-400">
            {graph.compactMode
              ? 'Large proof map detected. Compact priority list mode enabled.'
              : 'Proof map ready. Select a node to inspect goals.'}
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-[280px] flex-1">
        <CardHeader className="pb-2">
          <CardTitle>Proof Map (DAG)</CardTitle>
          <CardDescription>
            {graph.compactMode
              ? 'Compact mode: top-priority nodes only'
              : 'Dependency map for proof navigation (dependency -> node)'}
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[48vh] min-h-[320px]">
          {graph.compactMode
            ? (
                <div className="grid h-full gap-2 overflow-auto">
                  {compactNodes.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => onNodeSelect(node.id)}
                      className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-left text-xs hover:border-sky-400"
                    >
                      <span>{node.label || node.id} · line {node.startLine}</span>
                      <Badge variant={statusToBadgeVariant(node.statusKind)}>{node.statusKind}</Badge>
                    </button>
                  ))}
                </div>
              )
            : (
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  fitView
                  viewport={viewport}
                  onViewportChange={setViewport}
                  minZoom={0.1}
                  maxZoom={3.5}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  onNodeClick={(_, node) => onNodeSelect(node.id)}
                >
                  <Background color="#223045" gap={24} />
                </ReactFlow>
              )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Goal Diff</CardTitle>
          <CardDescription>
            {projection.selectedNode
              ? `${projection.selectedNode.label || projection.selectedNode.id}`
              : 'Select a node to inspect goal transitions'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {!projection.selectedNode && <div className="text-slate-400">No selected node.</div>}
          {projection.selectedNode && (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant={statusToBadgeVariant(projection.selectedNode.statusKind)}>{projection.selectedNode.statusKind}</Badge>
                <Badge>{projection.selectedNode.kind}</Badge>
                <Badge>line {projection.selectedNode.startLine}-{projection.selectedNode.endLine}</Badge>
              </div>

              {projection.goalChain.length === 0
                ? (
                    <div className="rounded-md border border-slate-700 bg-slate-950/70 p-2 text-slate-300">
                      <div className="mb-1 text-slate-400">current goal</div>
                      <pre className="overflow-auto whitespace-pre-wrap">{projection.selectedNode.goalCurrent ?? 'No goal text.'}</pre>
                    </div>
                  )
                : (
                    <div className="space-y-2">
                      {projection.goalChain.map((snapshot, index) => (
                        <div key={`${snapshot.tactic}:${index}`} className="rounded-md border border-slate-700 bg-slate-950/70 p-2">
                          <div className="mb-1 flex items-center gap-2">
                            <Badge>{snapshot.tactic}</Badge>
                            <span className="text-slate-400">subgoals +{snapshot.subgoalsCreated}</span>
                          </div>
                          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                            <div>
                              <div className="mb-1 text-slate-500">before</div>
                              <pre className="overflow-auto whitespace-pre-wrap text-slate-300">{snapshot.before}</pre>
                            </div>
                            <div>
                              <div className="mb-1 text-slate-500">after</div>
                              <pre className="overflow-auto whitespace-pre-wrap text-slate-300">{snapshot.after ?? 'unresolved'}</pre>
                            </div>
                          </div>
                          {snapshot.appliedLemmas.length > 0 && (
                            <div className="mt-2 text-slate-400">applied: {snapshot.appliedLemmas.join(', ')}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
            </>
          )}
        </CardContent>
      </Card>

      {projection.hasError && projection.activeDiagnosis && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Diagnosis</CardTitle>
            <CardDescription>{projection.activeDiagnosis.errorCategory}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-slate-700 bg-slate-950/70 p-2 text-slate-300">
              {projection.activeDiagnosis.rawMessage}
            </pre>
            {(projection.activeDiagnosis.expected || projection.activeDiagnosis.actual) && (
              <div className="rounded-md border border-slate-700 bg-slate-950/70 p-2 text-slate-300">
                {projection.activeDiagnosis.expected && <div>expected: {projection.activeDiagnosis.expected}</div>}
                {projection.activeDiagnosis.actual && <div>actual: {projection.activeDiagnosis.actual}</div>}
                {projection.activeDiagnosis.mismatchPath && <div>path: {projection.activeDiagnosis.mismatchPath}</div>}
              </div>
            )}
            {projection.activeDiagnosis.hint && (
              <div className="rounded-md border border-slate-700 bg-slate-950/70 p-2 text-amber-200">
                {projection.activeDiagnosis.hint}
              </div>
            )}
            {projection.activeDiagnosis.suggestedTactic && (
              <div className="rounded-md border border-slate-700 bg-slate-950/70 p-2 text-cyan-200">
                try: {projection.activeDiagnosis.suggestedTactic}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {projection.hasSorries && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Sorry Queue</CardTitle>
            <CardDescription>dependentCount desc, difficulty asc</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {projection.sorryQueue.map((item) => (
              <button
                key={item.nodeId}
                type="button"
                onClick={() => onNodeSelect(item.nodeId)}
                className="flex w-full items-center justify-between rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-left hover:border-sky-400"
              >
                <span className="truncate">{item.label}</span>
                <span className="text-slate-400">blocks {item.dependentCount} · diff {item.estimatedDifficulty.toFixed(2)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default App
