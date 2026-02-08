import type { AppState } from '@manifesto-ai/app'
import type {
  AttemptRecord,
  AttemptResult,
  DagMetrics,
  ErrorCategory,
  LayoutDirection,
  PatternEntry,
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

export type ProjectionAttemptOverview = {
  totalAttempts: number
  fileAttempts: number
  selectedNodeAttempts: number
}

export type ProjectionAttemptPreview = {
  id: string
  tacticKey: string
  result: AttemptResult
  timestamp: number
  errorCategory: ErrorCategory | null
}

export type ProjectionNodeHistory = {
  nodeId: string
  totalAttempts: number
  currentStreak: number
  lastAttemptAt: number | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
  lastResult: AttemptResult | null
  lastErrorCategory: ErrorCategory | null
  recentAttempts: ProjectionAttemptPreview[]
} | null

export type ProjectionPatternInsight = {
  key: string
  errorCategory: ErrorCategory
  tacticKey: string
  successCount: number
  failureCount: number
  score: number
  lastUpdated: number
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
  attemptOverview: ProjectionAttemptOverview
  nodes: ProjectionNode[]
  selectedNode: ProjectionNode | null
  selectedNodeHistory: ProjectionNodeHistory
  patternInsights: ProjectionPatternInsight[]
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

const sortAttemptsByRecency = (
  attempts: Record<string, AttemptRecord>
): AttemptRecord[] => Object.values(attempts)
  .slice()
  .sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return right.timestamp - left.timestamp
    }
    return right.id.localeCompare(left.id)
  })

const toNodeHistory = (
  attempts: Record<string, AttemptRecord>,
  nodeId: string,
  totalAttempts: number,
  currentStreak: number,
  lastAttemptAt: number | null,
  lastSuccessAt: number | null,
  lastFailureAt: number | null
): ProjectionNodeHistory => {
  const sorted = sortAttemptsByRecency(attempts)
  const latest = sorted[0]

  return {
    nodeId,
    totalAttempts,
    currentStreak,
    lastAttemptAt,
    lastSuccessAt,
    lastFailureAt,
    lastResult: latest?.result ?? null,
    lastErrorCategory: latest?.contextErrorCategory ?? null,
    recentAttempts: sorted.slice(0, 5).map((attempt) => ({
      id: attempt.id,
      tacticKey: attempt.tacticKey,
      result: attempt.result,
      timestamp: attempt.timestamp,
      errorCategory: attempt.contextErrorCategory
    }))
  }
}

const toPatternInsights = (
  entries: Record<string, PatternEntry>,
  selectedErrorCategory: ErrorCategory | null
): ProjectionPatternInsight[] => {
  const sorted = Object.values(entries)
    .map((entry) => ({
      key: entry.key,
      errorCategory: entry.errorCategory,
      tacticKey: entry.tacticKey,
      successCount: entry.successCount,
      failureCount: entry.failureCount,
      score: entry.score,
      lastUpdated: entry.lastUpdated
    }))
    .sort((left, right) => {
      const leftTotal = left.successCount + left.failureCount
      const rightTotal = right.successCount + right.failureCount
      if (leftTotal !== rightTotal) {
        return rightTotal - leftTotal
      }
      if (left.score !== right.score) {
        return right.score - left.score
      }
      return right.lastUpdated - left.lastUpdated
    })

  if (!selectedErrorCategory) {
    return sorted.slice(0, 5)
  }

  const matched = sorted.filter((entry) => entry.errorCategory === selectedErrorCategory)
  if (matched.length > 0) {
    return matched.slice(0, 5)
  }

  return sorted.slice(0, 5)
}

export const selectProjectionState = (appState: AppState<unknown>): ProjectionState => {
  const state = appState.data as ProofFlowState
  const computed = appState.computed as Record<string, unknown>
  const activeDag = (computed['computed.activeDag'] as ProofDAG | null) ?? null
  const selectedNodeRaw = computed['computed.selectedNode'] as ProofNode | null | undefined
  const nodes = toProjectionNodes(activeDag)
  const activeFileUri = state.ui.activeFileUri
  const selectedNodeId = state.ui.selectedNodeId ?? state.ui.cursorNodeId
  const fileHistory = activeFileUri ? state.history.files[activeFileUri] : undefined
  const nodeHistory = selectedNodeId ? fileHistory?.nodes[selectedNodeId] : undefined
  const selectedNodeHistory = nodeHistory
    ? toNodeHistory(
        nodeHistory.attempts,
        nodeHistory.nodeId,
        nodeHistory.totalAttempts,
        nodeHistory.currentStreak,
        nodeHistory.lastAttemptAt,
        nodeHistory.lastSuccessAt,
        nodeHistory.lastFailureAt
      )
    : null
  const selectedErrorCategory = selectedNodeRaw?.status.errorCategory ?? null
  const patternInsights = toPatternInsights(state.patterns.entries, selectedErrorCategory)

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
    attemptOverview: {
      totalAttempts: state.patterns.totalAttempts,
      fileAttempts: fileHistory?.totalAttempts ?? 0,
      selectedNodeAttempts: nodeHistory?.totalAttempts ?? 0
    },
    nodes,
    selectedNode: selectedNodeRaw ? toProjectionNode(selectedNodeRaw) : null,
    selectedNodeHistory,
    patternInsights
  }
}
