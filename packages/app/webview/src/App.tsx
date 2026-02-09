import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import type { ProjectionNode, ProjectionState } from '../../src/projection-state.js'
import {
  parseExtensionToPanelMessage,
  type PanelToExtensionMessage
} from '../../src/panel-contract.js'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Input } from './components/ui/input'
import { toGraphLayout, type GraphNode } from './lib/graph'
import { cn } from './lib/utils'

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

const toPercent = (ratio: number): number => Math.max(0, Math.min(100, Math.round(ratio * 100)))

const ProofNodeCard = ({ data }: NodeProps<Node>) => {
  const node = data as GraphNode

  return (
    <div
      className={cn(
        'w-60 rounded-lg border p-3 text-xs shadow-md transition-colors',
        node.selected && 'border-sky-400 bg-slate-900/95',
        !node.selected && 'border-slate-700 bg-slate-950/90'
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="truncate text-sm font-semibold text-slate-100">{node.label || node.id}</div>
        <Badge variant={statusToBadgeVariant(node.statusKind)}>{node.statusKind}</Badge>
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
  const [tactic, setTactic] = useState('')

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

  const send = useCallback((message: PanelToExtensionMessage) => {
    postMessage(message)
  }, [postMessage])

  const selectedGoal = projection.selectedGoal
  const selectedNodeId = useMemo(() => (
    projection.nodes.find((node) => node.goalId === selectedGoal?.id)?.id ?? null
  ), [projection.nodes, selectedGoal?.id])

  const graph = useMemo(() => toGraphLayout({
    nodes: projection.nodes,
    layout: 'topDown',
    selectedNodeId,
    cursorNodeId: null
  }), [projection.nodes, selectedNodeId])

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
    markerEnd: { type: MarkerType.ArrowClosed }
  })), [graph.edges])

  const percent = toPercent(projection.progress.ratio)

  return (
    <div className="flex h-full min-h-full flex-col gap-3 overflow-y-auto bg-[#0a1019] px-3 py-3 text-slate-100">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>ProofFlow</CardTitle>
          <CardDescription>{projection.activeFileUri ?? 'No active Lean file'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge>{projection.progress.resolvedGoals}/{projection.progress.totalGoals} goals ({percent}%)</Badge>
            <Badge variant="warning">open: {projection.progress.openGoals}</Badge>
            <Badge variant="error">failed: {projection.progress.failedGoals}</Badge>
            <Badge variant={projection.isComplete ? 'success' : 'info'}>{projection.isComplete ? 'complete' : 'in-progress'}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Goals</CardTitle>
          <CardDescription>Select a goal and apply one tactic per intent</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {projection.goals.length === 0 && <div className="text-slate-400">No goals extracted.</div>}
          {projection.goals.map((goal) => (
            <button
              key={goal.id}
              type="button"
              onClick={() => send({ type: 'selectGoal', payload: { goalId: goal.id } })}
              className={cn(
                'flex w-full items-start justify-between rounded-md border px-3 py-2 text-left',
                projection.selectedGoal?.id === goal.id
                  ? 'border-sky-400 bg-slate-900'
                  : 'border-slate-700 bg-slate-950/70 hover:border-slate-500'
              )}
            >
              <span className="truncate pr-2">{goal.statement}</span>
              <Badge variant={goal.status === 'resolved' ? 'success' : goal.status === 'failed' ? 'error' : 'warning'}>{goal.status}</Badge>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Tactic</CardTitle>
          <CardDescription>{selectedGoal ? selectedGoal.id : 'Select a goal first'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <Input
            value={tactic}
            onChange={(event) => setTactic(event.target.value)}
            placeholder="ex) simp, exact ih, omega"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!selectedGoal || tactic.trim().length === 0 || projection.isTacticPending}
              onClick={() => {
                if (!selectedGoal) {
                  return
                }

                send({
                  type: 'applyTactic',
                  payload: {
                    goalId: selectedGoal.id,
                    tactic: tactic.trim()
                  }
                })
              }}
            >
              Apply Tactic
            </Button>
            <Button variant="outline" size="sm" onClick={() => send({ type: 'togglePanel' })}>Hide Panel</Button>
          </div>
          {projection.tacticResult && (
            <div className="rounded-md border border-slate-700 bg-slate-950/70 p-2">
              <div className="mb-2 flex items-center gap-2">
                <Badge variant={projection.tacticResult.succeeded ? 'success' : 'error'}>
                  {projection.tacticResult.succeeded ? 'succeeded' : 'failed'}
                </Badge>
                <span className="text-slate-300">{projection.tacticResult.tactic}</span>
              </div>
              <div className="flex gap-2">
                {projection.tacticResult.succeeded
                  ? <Button size="sm" onClick={() => send({ type: 'commitTactic' })}>Commit</Button>
                  : <Button size="sm" variant="outline" onClick={() => send({ type: 'dismissTactic' })}>Dismiss</Button>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="min-h-[280px] flex-1">
        <CardHeader className="pb-2">
          <CardTitle>Proof Map (DAG)</CardTitle>
          <CardDescription>Dependency map for proof navigation</CardDescription>
        </CardHeader>
        <CardContent className="h-[44vh] min-h-[300px]">
          {graph.compactMode
            ? <div className="text-xs text-slate-400">Large map detected. Reduce active proof scope to inspect graph.</div>
            : (
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  fitView
                  minZoom={0.2}
                  maxZoom={2.5}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  onNodeClick={(_, node) => {
                    const graphNode = node.data as GraphNode
                    send({
                      type: 'selectGoal',
                      payload: {
                        goalId: graphNode.goalId
                      }
                    })
                  }}
                >
                  <Background color="#223045" gap={24} />
                </ReactFlow>
              )}
        </CardContent>
      </Card>
    </div>
  )
}

export default App
