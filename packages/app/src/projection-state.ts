import type { AppState } from '@manifesto-ai/app'
import type {
  DagMetrics,
  LayoutDirection,
  ProofDAG,
  ProofFlowState,
  ProofNode
} from '@proof-flow/schema'

export type ProjectionNode = {
  id: string
  label: string
  kind: ProofNode['kind']
  statusKind: ProofNode['status']['kind']
  errorMessage: string | null
  errorCategory: ProofNode['status']['errorCategory']
  startLine: number
  endLine: number
  startCol: number
  endCol: number
  children: string[]
  dependencies: string[]
}

export type ProjectionState = {
  ui: {
    panelVisible: boolean
    activeFileUri: string | null
    selectedNodeId: string | null
    cursorNodeId: string | null
    layout: LayoutDirection
    zoom: number
    collapseResolved: boolean
  }
  activeDag: {
    fileUri: string
    rootIds: string[]
    totalNodes: number
  } | null
  summaryMetrics: DagMetrics | null
  nodes: ProjectionNode[]
  selectedNode: ProjectionNode | null
}

const toProjectionNode = (node: ProofNode): ProjectionNode => ({
  id: node.id,
  label: node.label,
  kind: node.kind,
  statusKind: node.status.kind,
  errorMessage: node.status.errorMessage,
  errorCategory: node.status.errorCategory,
  startLine: node.leanRange.startLine,
  endLine: node.leanRange.endLine,
  startCol: node.leanRange.startCol,
  endCol: node.leanRange.endCol,
  children: [...node.children],
  dependencies: [...node.dependencies]
})

const toProjectionNodes = (dag: ProofDAG | null): ProjectionNode[] => {
  if (!dag) {
    return []
  }

  return Object.values(dag.nodes)
    .map(toProjectionNode)
    .sort((left, right) => {
      if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine
      }

      if (left.startCol !== right.startCol) {
        return left.startCol - right.startCol
      }

      return left.id.localeCompare(right.id)
    })
}

export const selectProjectionState = (appState: AppState<unknown>): ProjectionState => {
  const state = appState.data as ProofFlowState
  const computed = appState.computed as Record<string, unknown>
  const activeDag = (computed['computed.activeDag'] as ProofDAG | null) ?? null
  const selectedNodeRaw = computed['computed.selectedNode'] as ProofNode | null | undefined
  const nodes = toProjectionNodes(activeDag)

  return {
    ui: {
      panelVisible: state.ui.panelVisible,
      activeFileUri: state.ui.activeFileUri,
      selectedNodeId: state.ui.selectedNodeId,
      cursorNodeId: state.ui.cursorNodeId,
      layout: state.ui.layout,
      zoom: state.ui.zoom,
      collapseResolved: state.ui.collapseResolved
    },
    activeDag: activeDag
      ? {
          fileUri: activeDag.fileUri,
          rootIds: [...activeDag.rootIds],
          totalNodes: Object.keys(activeDag.nodes).length
        }
      : null,
    summaryMetrics: (computed['computed.summaryMetrics'] as DagMetrics | null) ?? null,
    nodes,
    selectedNode: selectedNodeRaw ? toProjectionNode(selectedNodeRaw) : null
  }
}
