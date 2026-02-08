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

const MIN_PATTERN_SAMPLE = 3
const START_HERE_LIMIT = 10

const START_HERE_STATUS_WEIGHT: Record<ProofNode['status']['kind'], number> = {
  sorry: 120,
  error: 100,
  in_progress: 80,
  resolved: 0
}

export type ProjectionHeatLevel = 'none' | 'low' | 'medium' | 'high'

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
  attemptCount: number
  heatLevel: ProjectionHeatLevel
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
  sampleSize: number
  score: number
  successRate: number
  lastUpdated: number
}

export type ProjectionSuggestion = {
  tacticKey: string
  score: number
  sampleSize: number
  successRate: number
  sourceCategory: ErrorCategory | null
  generatedAt: number
}

export type ProjectionStartHereEntry = {
  nodeId: string
  label: string
  statusKind: ProofNode['status']['kind']
  startLine: number
  attemptCount: number
  priority: number
  reason: string
}

export type ProjectionDashboard = {
  totalPatterns: number
  qualifiedPatterns: number
  errorCategoryTotals: Record<ErrorCategory, number>
  topNodeAttempts: Array<{
    nodeId: string
    totalAttempts: number
    currentStreak: number
    lastResult: AttemptResult | null
  }>
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
  nodeHeatmap: Record<string, { attemptCount: number; heatLevel: ProjectionHeatLevel }>
  dashboard: ProjectionDashboard
  nodes: ProjectionNode[]
  selectedNode: ProjectionNode | null
  selectedNodeHistory: ProjectionNodeHistory
  patternInsights: ProjectionPatternInsight[]
  selectedNodeSuggestions: ProjectionSuggestion[]
  startHereQueue: ProjectionStartHereEntry[]
}

type FileHistory = ProofFlowState['history']['files'][string]
type NodeHistory = FileHistory['nodes'][string]

type NormalizedPattern = ProjectionPatternInsight & {
  qualified: boolean
}

const emptyErrorCategoryTotals = (): Record<ErrorCategory, number> => ({
  TYPE_MISMATCH: 0,
  UNKNOWN_IDENTIFIER: 0,
  TACTIC_FAILED: 0,
  UNSOLVED_GOALS: 0,
  TIMEOUT: 0,
  KERNEL_ERROR: 0,
  SYNTAX_ERROR: 0,
  OTHER: 0
})

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const asNumber = (value: unknown, fallback = 0): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
)

const asNullableNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
)

const toHeatLevel = (count: number): ProjectionHeatLevel => {
  if (count <= 0) {
    return 'none'
  }
  if (count <= 3) {
    return 'low'
  }
  if (count <= 10) {
    return 'medium'
  }
  return 'high'
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

const latestAttemptResult = (attempts: Record<string, AttemptRecord>): AttemptResult | null => {
  const latest = sortAttemptsByRecency(attempts)[0]
  return latest?.result ?? null
}

const toNodeAttemptCounts = (fileHistory: FileHistory | undefined): Record<string, number> => {
  if (!fileHistory) {
    return {}
  }

  const entries = Object.values(fileHistory.nodes).map((node) => [
    node.nodeId,
    node.totalAttempts
  ] as const)

  return Object.fromEntries(entries)
}

const toProjectionNode = (
  node: ProofNode,
  attemptCount: number
): ProjectionNode => ({
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
  dependencies: [...node.dependencies],
  attemptCount,
  heatLevel: toHeatLevel(attemptCount)
})

const toProjectionNodes = (
  dag: ProofDAG | null,
  nodeAttempts: Record<string, number>
): ProjectionNode[] => {
  if (!dag) {
    return []
  }

  return Object.values(dag.nodes)
    .map((node) => toProjectionNode(node, nodeAttempts[node.id] ?? 0))
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

const toNormalizedPatterns = (
  entries: Record<string, PatternEntry>
): NormalizedPattern[] => Object.values(entries)
  .map((entry) => {
    const sampleSize = entry.successCount + entry.failureCount
    const successRate = sampleSize > 0 ? entry.successCount / sampleSize : 0

    return {
      key: entry.key,
      errorCategory: entry.errorCategory,
      tacticKey: entry.tacticKey,
      successCount: entry.successCount,
      failureCount: entry.failureCount,
      sampleSize,
      score: entry.score,
      successRate,
      lastUpdated: entry.lastUpdated,
      qualified: sampleSize >= MIN_PATTERN_SAMPLE
    }
  })

const sortPatterns = (patterns: NormalizedPattern[]): NormalizedPattern[] => patterns
  .slice()
  .sort((left, right) => {
    if (left.successRate !== right.successRate) {
      return right.successRate - left.successRate
    }

    if (left.sampleSize !== right.sampleSize) {
      return right.sampleSize - left.sampleSize
    }

    if (left.score !== right.score) {
      return right.score - left.score
    }

    return right.lastUpdated - left.lastUpdated
  })

const toPatternInsights = (
  patterns: NormalizedPattern[],
  selectedErrorCategory: ErrorCategory | null
): ProjectionPatternInsight[] => {
  const qualified = patterns.filter((entry) => entry.qualified)
  const sorted = sortPatterns(qualified)

  if (selectedErrorCategory) {
    const matched = sorted.filter((entry) => entry.errorCategory === selectedErrorCategory)
    if (matched.length > 0) {
      return matched.slice(0, 5)
    }
  }

  return sorted.slice(0, 5)
}

const toDashboard = (
  patterns: NormalizedPattern[],
  fileHistory: FileHistory | undefined
): ProjectionDashboard => {
  const totals = emptyErrorCategoryTotals()
  for (const entry of patterns) {
    totals[entry.errorCategory] += entry.sampleSize
  }

  const topNodeAttempts = fileHistory
    ? Object.values(fileHistory.nodes)
      .map((node): ProjectionDashboard['topNodeAttempts'][number] => ({
        nodeId: node.nodeId,
        totalAttempts: node.totalAttempts,
        currentStreak: node.currentStreak,
        lastResult: latestAttemptResult(node.attempts)
      }))
      .sort((left, right) => {
        if (left.totalAttempts !== right.totalAttempts) {
          return right.totalAttempts - left.totalAttempts
        }
        return left.nodeId.localeCompare(right.nodeId)
      })
      .slice(0, 10)
    : []

  return {
    totalPatterns: patterns.length,
    qualifiedPatterns: patterns.filter((entry) => entry.qualified).length,
    errorCategoryTotals: totals,
    topNodeAttempts
  }
}

const toNodeHeatmap = (nodeAttempts: Record<string, number>): ProjectionState['nodeHeatmap'] => {
  const entries = Object.entries(nodeAttempts).map(([nodeId, count]) => [
    nodeId,
    {
      attemptCount: count,
      heatLevel: toHeatLevel(count)
    }
  ] as const)

  return Object.fromEntries(entries)
}

const toProjectionSuggestions = (
  state: ProofFlowState,
  selectedNodeId: string | null
): ProjectionSuggestion[] => {
  if (!selectedNodeId) {
    return []
  }

  const data = state as unknown as Record<string, unknown>
  const suggestions = asRecord(data.suggestions)
  const byNode = asRecord(suggestions?.byNode)
  const entries = byNode?.[selectedNodeId]
  if (!Array.isArray(entries)) {
    return []
  }

  return entries
    .map((entry): ProjectionSuggestion | null => {
      const candidate = asRecord(entry)
      if (!candidate) {
        return null
      }

      const tacticKey = typeof candidate.tacticKey === 'string'
        ? candidate.tacticKey
        : null

      if (!tacticKey) {
        return null
      }

      const sourceCategory = candidate.sourceCategory
      const normalizedCategory = (
        sourceCategory === null
          || sourceCategory === 'TYPE_MISMATCH'
          || sourceCategory === 'UNKNOWN_IDENTIFIER'
          || sourceCategory === 'TACTIC_FAILED'
          || sourceCategory === 'UNSOLVED_GOALS'
          || sourceCategory === 'TIMEOUT'
          || sourceCategory === 'KERNEL_ERROR'
          || sourceCategory === 'SYNTAX_ERROR'
          || sourceCategory === 'OTHER'
      )
        ? sourceCategory
        : null

      return {
        tacticKey,
        score: asNumber(candidate.score),
        sampleSize: asNumber(candidate.sampleSize),
        successRate: asNumber(candidate.successRate),
        sourceCategory: normalizedCategory,
        generatedAt: asNullableNumber(candidate.generatedAt) ?? 0
      }
    })
    .filter((entry): entry is ProjectionSuggestion => entry !== null)
}

const toStartHereQueue = (nodes: ProjectionNode[]): ProjectionStartHereEntry[] => {
  const unresolved = nodes.filter((node) => node.statusKind !== 'resolved')

  const queue = unresolved.map((node): ProjectionStartHereEntry => {
    let priority = START_HERE_STATUS_WEIGHT[node.statusKind]
    const reasons: string[] = []

    if (node.statusKind === 'sorry') {
      reasons.push('placeholder')
    }
    else if (node.statusKind === 'error') {
      reasons.push('error')
    }
    else if (node.statusKind === 'in_progress') {
      reasons.push('in-progress')
    }

    if (node.attemptCount === 0) {
      priority += 20
      reasons.push('unattempted')
    }
    else if (node.attemptCount <= 2) {
      priority += 8
      reasons.push('low-attempt')
    }
    else if (node.attemptCount >= 6) {
      priority -= 6
      reasons.push('high-attempt')
    }

    if (node.errorCategory === 'UNSOLVED_GOALS') {
      priority += 7
      reasons.push('unsolved-goals')
    }
    else if (node.errorCategory === 'TACTIC_FAILED') {
      priority += 4
      reasons.push('tactic-failed')
    }
    else if (node.errorCategory === 'TIMEOUT') {
      priority += 3
      reasons.push('timeout')
    }
    else if (node.errorCategory === 'TYPE_MISMATCH') {
      priority += 2
      reasons.push('type-mismatch')
    }

    const lineBias = Math.max(0, 3 - Math.floor(node.startLine / 200))
    if (lineBias > 0) {
      priority += lineBias
      reasons.push('near-top')
    }

    return {
      nodeId: node.id,
      label: node.label,
      statusKind: node.statusKind,
      startLine: node.startLine,
      attemptCount: node.attemptCount,
      priority,
      reason: reasons.join(', ')
    }
  })

  return queue
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority
      }

      if (left.attemptCount !== right.attemptCount) {
        return left.attemptCount - right.attemptCount
      }

      if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine
      }

      return left.nodeId.localeCompare(right.nodeId)
    })
    .slice(0, START_HERE_LIMIT)
}

export const selectProjectionState = (appState: AppState<unknown>): ProjectionState => {
  const state = appState.data as ProofFlowState
  const computed = appState.computed as Record<string, unknown>
  const activeDag = (computed['computed.activeDag'] as ProofDAG | null) ?? null
  const selectedNodeRaw = computed['computed.selectedNode'] as ProofNode | null | undefined
  const activeFileUri = state.ui.activeFileUri
  const selectedNodeId = state.ui.selectedNodeId ?? state.ui.cursorNodeId
  const fileHistory = activeFileUri ? state.history.files[activeFileUri] : undefined
  const nodeHistory = selectedNodeId ? fileHistory?.nodes[selectedNodeId] : undefined
  const nodeAttempts = toNodeAttemptCounts(fileHistory)
  const nodeHeatmap = toNodeHeatmap(nodeAttempts)
  const nodes = toProjectionNodes(activeDag, nodeAttempts)
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

  const normalizedPatterns = toNormalizedPatterns(state.patterns.entries)
  const preferredCategory = selectedNodeRaw?.status.errorCategory ?? null
  const patternInsights = toPatternInsights(normalizedPatterns, preferredCategory)
  const selectedNodeSuggestions = toProjectionSuggestions(state, selectedNodeId)
  const startHereQueue = toStartHereQueue(nodes)

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
    nodeHeatmap,
    dashboard: toDashboard(normalizedPatterns, fileHistory),
    nodes,
    selectedNode: selectedNodeRaw ? toProjectionNode(selectedNodeRaw, nodeAttempts[selectedNodeRaw.id] ?? 0) : null,
    selectedNodeHistory,
    patternInsights,
    selectedNodeSuggestions,
    startHereQueue
  }
}
