import type { AppState } from '@manifesto-ai/app'
import type {
  BreakageMap,
  Diagnosis,
  ErrorCategory,
  GoalSnapshot,
  ProofDAG,
  ProofFlowState,
  ProofNode,
  ProofProgress,
  SorryItem,
  StatusKind
} from '@proof-flow/schema'

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const asString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim().length > 0
    ? value
    : null
)

const asNumber = (value: unknown, fallback = 0): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
)

const asNullableNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
)

const STATUS_PRIORITY: Record<StatusKind, number> = {
  error: 0,
  sorry: 1,
  in_progress: 2,
  resolved: 3
}

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
  goalCurrent: string | null
  goalSnapshots: GoalSnapshot[]
  estimatedDistance: number | null
}

export type ProjectionProgress = ProofProgress
export type ProjectionSorryItem = SorryItem
export type ProjectionDiagnosis = Diagnosis

export type ProjectionBreakageEdge = {
  changedNodeId: string
  brokenNodeId: string
  errorCategory: ErrorCategory
  errorMessage: string | null
}

export type ProjectionBreakageMap = {
  edges: ProjectionBreakageEdge[]
  lastAnalyzedAt: number | null
} | null

export type ProjectionRuntimeDebug = {
  world: {
    headWorldId: string | null
    depth: number | null
    branchId: string | null
  }
}

export type ProjectionState = {
  ui: {
    panelVisible: boolean
    activeFileUri: string | null
    selectedNodeId: string | null
    cursorNodeId: string | null
  }
  activeDag: {
    fileUri: string
    rootIds: string[]
    totalNodes: number
  } | null
  progress: ProjectionProgress | null
  nodes: ProjectionNode[]
  selectedNode: ProjectionNode | null
  goalChain: GoalSnapshot[]
  hasSorries: boolean
  sorryQueue: ProjectionSorryItem[]
  hasError: boolean
  activeDiagnosis: ProjectionDiagnosis | null
  breakageMap: ProjectionBreakageMap
  runtimeDebug: ProjectionRuntimeDebug
}

const compareByPosition = (left: ProjectionNode, right: ProjectionNode): number => {
  if (left.startLine !== right.startLine) {
    return left.startLine - right.startLine
  }

  if (left.startCol !== right.startCol) {
    return left.startCol - right.startCol
  }

  return left.id.localeCompare(right.id)
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
  dependencies: [...node.dependencies],
  goalCurrent: node.goalCurrent ?? null,
  goalSnapshots: Array.isArray(node.goalSnapshots) ? [...node.goalSnapshots] : [],
  estimatedDistance: node.estimatedDistance ?? null
})

const toProjectionNodes = (dag: ProofDAG | null): ProjectionNode[] => {
  if (!dag) {
    return []
  }

  return Object.values(dag.nodes)
    .map((node) => toProjectionNode(node))
    .sort(compareByPosition)
}

const normalizeProgress = (
  progress: ProofProgress | null | undefined,
  nodes: ProjectionNode[]
): ProjectionProgress => {
  if (progress) {
    return {
      totalGoals: asNumber(progress.totalGoals),
      resolvedGoals: asNumber(progress.resolvedGoals),
      blockedGoals: asNumber(progress.blockedGoals),
      sorryGoals: asNumber(progress.sorryGoals),
      estimatedRemaining: asNullableNumber(progress.estimatedRemaining)
    }
  }

  const goalNodes = nodes.filter((node) => node.id !== 'root' && !node.id.startsWith('diag:'))
  const resolvedGoals = goalNodes.filter((node) => node.statusKind === 'resolved').length
  const blockedGoals = goalNodes.filter((node) => node.statusKind === 'error').length
  const sorryGoals = goalNodes.filter((node) => node.statusKind === 'sorry').length
  const unresolved = goalNodes.filter((node) => node.statusKind !== 'resolved')

  return {
    totalGoals: goalNodes.length,
    resolvedGoals,
    blockedGoals,
    sorryGoals,
    estimatedRemaining: unresolved.reduce((sum, node) => sum + (node.estimatedDistance ?? 1), 0)
  }
}

const deriveSorryQueueFromDag = (dag: ProofDAG | null): ProjectionSorryItem[] => {
  if (!dag) {
    return []
  }

  const dependentCount = new Map<string, number>()
  for (const node of Object.values(dag.nodes)) {
    for (const dependency of node.dependencies) {
      dependentCount.set(dependency, (dependentCount.get(dependency) ?? 0) + 1)
    }
  }

  return Object.values(dag.nodes)
    .filter((node) => node.status.kind === 'sorry')
    .map((node) => {
      const goalText = node.goalCurrent ?? node.label
      const estimatedDifficulty = Math.round(Math.min(1, goalText.length / 140) * 100) / 100
      return {
        nodeId: node.id,
        label: node.label,
        goalText,
        dependentCount: dependentCount.get(node.id) ?? 0,
        estimatedDifficulty
      }
    })
    .sort((left, right) => {
      if (left.dependentCount !== right.dependentCount) {
        return right.dependentCount - left.dependentCount
      }

      if (left.estimatedDifficulty !== right.estimatedDifficulty) {
        return left.estimatedDifficulty - right.estimatedDifficulty
      }

      return left.nodeId.localeCompare(right.nodeId)
    })
}

const normalizeSorryQueue = (
  state: ProofFlowState,
  dag: ProofDAG | null
): ProjectionSorryItem[] => {
  const queue = state.sorryQueue
  if (!queue || !Array.isArray(queue.items)) {
    return deriveSorryQueueFromDag(dag)
  }

  const normalized = queue.items
    .map((item): ProjectionSorryItem | null => {
      const candidate = asRecord(item)
      if (!candidate) {
        return null
      }

      const nodeId = asString(candidate.nodeId)
      const label = asString(candidate.label)
      const goalText = asString(candidate.goalText)
      if (!nodeId || !label || !goalText) {
        return null
      }

      return {
        nodeId,
        label,
        goalText,
        dependentCount: asNumber(candidate.dependentCount),
        estimatedDifficulty: asNumber(candidate.estimatedDifficulty)
      }
    })
    .filter((item): item is ProjectionSorryItem => item !== null)

  return normalized.length > 0 ? normalized : deriveSorryQueueFromDag(dag)
}

const normalizeDiagnosis = (diagnosis: Diagnosis | null | undefined): ProjectionDiagnosis | null => {
  if (!diagnosis) {
    return null
  }

  const candidate = asRecord(diagnosis)
  if (!candidate) {
    return null
  }

  const nodeId = asString(candidate.nodeId)
  const rawMessage = asString(candidate.rawMessage)
  const errorCategory = asString(candidate.errorCategory) as ErrorCategory | null
  if (!nodeId || !rawMessage || !errorCategory) {
    return null
  }

  return {
    nodeId,
    errorCategory,
    rawMessage,
    expected: asString(candidate.expected),
    actual: asString(candidate.actual),
    mismatchPath: asString(candidate.mismatchPath),
    hint: asString(candidate.hint),
    suggestedTactic: asString(candidate.suggestedTactic)
  }
}

const normalizeBreakageMap = (breakageMap: BreakageMap | null | undefined): ProjectionBreakageMap => {
  if (!breakageMap) {
    return null
  }

  const candidate = asRecord(breakageMap)
  if (!candidate || !Array.isArray(candidate.edges)) {
    return null
  }

  const edges = candidate.edges
    .map((entry): ProjectionBreakageEdge | null => {
      const edge = asRecord(entry)
      if (!edge) {
        return null
      }

      const changedNodeId = asString(edge.changedNodeId)
      const brokenNodeId = asString(edge.brokenNodeId)
      const errorCategory = asString(edge.errorCategory) as ErrorCategory | null
      if (!changedNodeId || !brokenNodeId || !errorCategory) {
        return null
      }

      return {
        changedNodeId,
        brokenNodeId,
        errorCategory,
        errorMessage: asString(edge.errorMessage)
      }
    })
    .filter((entry): entry is ProjectionBreakageEdge => entry !== null)

  return {
    edges,
    lastAnalyzedAt: asNullableNumber(candidate.lastAnalyzedAt)
  }
}

const pickSelectedNodeId = (state: ProofFlowState): string | null => (
  state.selectedNodeId ?? state.cursorNodeId
)

const rankNodesForFocus = (nodes: ProjectionNode[]): ProjectionNode[] => (
  [...nodes].sort((left, right) => {
    const leftRank = STATUS_PRIORITY[left.statusKind] ?? 99
    const rightRank = STATUS_PRIORITY[right.statusKind] ?? 99
    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }

    const leftDistance = left.estimatedDistance ?? Number.POSITIVE_INFINITY
    const rightDistance = right.estimatedDistance ?? Number.POSITIVE_INFINITY
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance
    }

    return compareByPosition(left, right)
  })
)

export const selectProjectionState = (appState: AppState<unknown>): ProjectionState => {
  const state = appState.data as ProofFlowState
  const computed = appState.computed as Record<string, unknown>
  const activeFileUri = state.activeFileUri

  const computedActiveDag = (computed['computed.activeDag'] as ProofDAG | null) ?? null
  const dataActiveDag = activeFileUri
    ? state.files[activeFileUri]?.dag ?? null
    : null
  const activeDag = computedActiveDag ?? dataActiveDag

  const nodes = toProjectionNodes(activeDag)
  const progress = normalizeProgress(activeDag?.progress ?? null, nodes)

  const selectedNodeId = pickSelectedNodeId(state)
  const selectedNode = selectedNodeId
    ? nodes.find((node) => node.id === selectedNodeId) ?? null
    : null

  const fallbackFocusNode = selectedNode
    ?? rankNodesForFocus(nodes).find((node) => node.statusKind !== 'resolved')
    ?? null

  const goalChain = fallbackFocusNode?.goalSnapshots ?? []
  const sorryQueue = normalizeSorryQueue(state, activeDag)
  const activeDiagnosis = normalizeDiagnosis(state.activeDiagnosis)

  return {
    ui: {
      panelVisible: state.panelVisible,
      activeFileUri: state.activeFileUri,
      selectedNodeId: state.selectedNodeId,
      cursorNodeId: state.cursorNodeId
    },
    activeDag: activeDag
      ? {
          fileUri: activeDag.fileUri,
          rootIds: [...activeDag.rootIds],
          totalNodes: Object.keys(activeDag.nodes).length
        }
      : null,
    progress,
    nodes,
    selectedNode: fallbackFocusNode,
    goalChain,
    hasSorries: sorryQueue.length > 0,
    sorryQueue,
    hasError: activeDiagnosis !== null,
    activeDiagnosis,
    breakageMap: normalizeBreakageMap(state.breakageMap),
    runtimeDebug: {
      world: {
        headWorldId: null,
        depth: null,
        branchId: null
      }
    }
  }
}
