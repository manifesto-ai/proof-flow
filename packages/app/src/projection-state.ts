import type { AppState } from '@manifesto-ai/sdk'
import type { LeanDiagnostic } from '@proof-flow/host'
import type {
  Goal,
  GoalStatus,
  ProofFlowState,
  TacticResult
} from '@proof-flow/schema'

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const asString = (value: unknown): string | null => (
  typeof value === 'string' && value.length > 0 ? value : null
)

const asNullableString = (value: unknown): string | null => (
  typeof value === 'string' ? value : null
)

const asNullableNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
)

const asGoalStatus = (value: unknown): GoalStatus | null => {
  if (value === 'open' || value === 'resolved' || value === 'failed') {
    return value
  }

  return null
}

type HostDagNode = {
  nodeId: string
  label: string
  kind: string
  startLine: number
  endLine: number
  parentId: string | null
  status: 'resolved' | 'error' | 'sorry' | 'in_progress'
  errorMessage: string | null
  errorCategory: string | null
  goalId: string | null
}

type HostDagEdge = {
  source: string
  target: string
}

type HostLeanState = {
  fileUri: string | null
  dag: {
    nodes: Record<string, HostDagNode>
    edges: HostDagEdge[]
  }
  diagnostics: LeanDiagnostic[]
}

export type ProjectionGoal = Goal

export type ProjectionNode = {
  id: string
  goalId: string | null
  label: string
  kind: string
  statusKind: 'resolved' | 'error' | 'sorry' | 'in_progress'
  errorMessage: string | null
  errorCategory: string | null
  startLine: number
  endLine: number
  startCol: number
  endCol: number
  children: string[]
  dependencies: string[]
  goalCurrent: string | null
}

export type ProjectionProgress = {
  totalGoals: number
  resolvedGoals: number
  openGoals: number
  failedGoals: number
  ratio: number
}

export type ProjectionState = {
  ui: {
    panelVisible: boolean
  }
  activeFileUri: string | null
  goals: ProjectionGoal[]
  selectedGoal: ProjectionGoal | null
  progress: ProjectionProgress
  isComplete: boolean
  isTacticPending: boolean
  lastTactic: string | null
  tacticResult: TacticResult | null
  nodes: ProjectionNode[]
  diagnostics: LeanDiagnostic[]
}

const normalizeGoal = (entry: unknown): Goal | null => {
  const record = asRecord(entry)
  if (!record) {
    return null
  }

  const id = asString(record.id)
  const statement = asString(record.statement)
  const status = asGoalStatus(record.status)

  if (!id || !statement || !status) {
    return null
  }

  return {
    id,
    statement,
    status
  }
}

const toGoalList = (goalsRecord: Record<string, unknown> | null): Goal[] => {
  if (!goalsRecord) {
    return []
  }

  return Object.values(goalsRecord)
    .map((entry) => normalizeGoal(entry))
    .filter((goal): goal is Goal => goal !== null)
    .sort((left, right) => left.id.localeCompare(right.id))
}

const parseHostLeanState = (stateData: Record<string, unknown>): HostLeanState => {
  const host = asRecord(stateData.$host)
  const leanState = host ? asRecord(host.leanState) : null

  const fileUri = asString(leanState?.fileUri)
  const dagRecord = leanState ? asRecord(leanState.dag) : null
  const dagNodesRecord = dagRecord ? asRecord(dagRecord.nodes) : null
  const dagEdgesRaw = dagRecord?.edges

  const nodes: Record<string, HostDagNode> = {}
  if (dagNodesRecord) {
    for (const [nodeId, rawNode] of Object.entries(dagNodesRecord)) {
      const node = asRecord(rawNode)
      if (!node) {
        continue
      }

      const status = node.status
      if (status !== 'resolved' && status !== 'error' && status !== 'sorry' && status !== 'in_progress') {
        continue
      }

      nodes[nodeId] = {
        nodeId,
        label: asString(node.label) ?? nodeId,
        kind: asString(node.kind) ?? 'definition',
        startLine: Math.max(1, Math.floor(asNullableNumber(node.startLine) ?? 1)),
        endLine: Math.max(1, Math.floor(asNullableNumber(node.endLine) ?? 1)),
        parentId: asString(node.parentId),
        status,
        errorMessage: asString(node.errorMessage),
        errorCategory: asString(node.errorCategory),
        goalId: asString(node.goalId)
      }
    }
  }

  const edges: HostDagEdge[] = Array.isArray(dagEdgesRaw)
    ? dagEdgesRaw
        .map((entry) => {
          const edge = asRecord(entry)
          const source = asString(edge?.source)
          const target = asString(edge?.target)
          if (!source || !target) {
            return null
          }

          return { source, target }
        })
        .filter((edge): edge is HostDagEdge => edge !== null)
    : []

  const diagnostics = Array.isArray(leanState?.diagnostics)
    ? leanState.diagnostics as LeanDiagnostic[]
    : []

  return {
    fileUri,
    dag: {
      nodes,
      edges
    },
    diagnostics
  }
}

const toProjectionNodes = (
  hostState: HostLeanState,
  goals: Goal[]
): ProjectionNode[] => {
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]))
  const children = new Map<string, string[]>()
  const dependencies = new Map<string, string[]>()

  for (const edge of hostState.dag.edges) {
    if (!children.has(edge.source)) {
      children.set(edge.source, [])
    }
    children.get(edge.source)?.push(edge.target)

    if (!dependencies.has(edge.target)) {
      dependencies.set(edge.target, [])
    }
    dependencies.get(edge.target)?.push(edge.source)
  }

  return Object.values(hostState.dag.nodes)
    .filter((node) => node.nodeId !== 'root')
    .map((node) => {
      const linkedGoal = node.goalId ? goalsById.get(node.goalId) : null

      return {
        id: node.nodeId,
        goalId: node.goalId,
        label: node.label,
        kind: node.kind,
        statusKind: node.status,
        errorMessage: node.errorMessage,
        errorCategory: node.errorCategory,
        startLine: node.startLine,
        endLine: node.endLine,
        startCol: 0,
        endCol: 0,
        children: [...(children.get(node.nodeId) ?? [])],
        dependencies: [...(dependencies.get(node.nodeId) ?? [])],
        goalCurrent: linkedGoal?.statement ?? null
      }
    })
    .sort((left, right) => {
      if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine
      }

      return left.id.localeCompare(right.id)
    })
}

const toProgress = (goals: Goal[]): ProjectionProgress => {
  const totalGoals = goals.length
  const resolvedGoals = goals.filter((goal) => goal.status === 'resolved').length
  const openGoals = goals.filter((goal) => goal.status === 'open').length
  const failedGoals = goals.filter((goal) => goal.status === 'failed').length
  const ratio = totalGoals > 0 ? resolvedGoals / totalGoals : 0

  return {
    totalGoals,
    resolvedGoals,
    openGoals,
    failedGoals,
    ratio
  }
}

const normalizeTacticResult = (value: unknown): TacticResult | null => {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const goalId = asString(record.goalId)
  const tactic = asString(record.tactic)
  const succeeded = record.succeeded
  const newGoalIds = record.newGoalIds
  const errorMessage = asNullableString(record.errorMessage)

  if (!goalId || !tactic || typeof succeeded !== 'boolean' || !Array.isArray(newGoalIds)) {
    return null
  }

  const normalizedNewGoalIds = newGoalIds.filter((entry): entry is string => typeof entry === 'string')

  return {
    goalId,
    tactic,
    succeeded,
    newGoalIds: normalizedNewGoalIds,
    errorMessage
  }
}

export const selectProjectionState = (
  appState: AppState<unknown>,
  panelVisible: boolean
): ProjectionState => {
  const stateData = appState.data as ProofFlowState & Record<string, unknown>
  const computed = (appState.computed ?? {}) as Record<string, unknown>

  const goals = toGoalList(asRecord(stateData.goals))
  const progress = toProgress(goals)
  const selectedGoal = goals.find((goal) => goal.id === stateData.activeGoalId) ?? null
  const hostState = parseHostLeanState(stateData)
  const nodes = toProjectionNodes(hostState, goals)

  const computedPending = computed['computed.isTacticPending']
  const isTacticPending = typeof computedPending === 'boolean'
    ? computedPending
    : Boolean(stateData.applyingTactic && stateData.tacticResult)

  return {
    ui: {
      panelVisible
    },
    activeFileUri: hostState.fileUri,
    goals,
    selectedGoal,
    progress,
    isComplete: progress.totalGoals > 0 && progress.openGoals === 0,
    isTacticPending,
    lastTactic: stateData.lastTactic,
    tacticResult: normalizeTacticResult(stateData.tacticResult),
    nodes,
    diagnostics: hostState.diagnostics
  }
}
