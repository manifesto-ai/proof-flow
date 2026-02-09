export type NodeKind =
  | 'theorem'
  | 'lemma'
  | 'have'
  | 'let'
  | 'suffices'
  | 'show'
  | 'calc_step'
  | 'case'
  | 'sorry'
  | 'tactic_block'

export type StatusKind = 'resolved' | 'error' | 'sorry' | 'in_progress'

export type ErrorCategory =
  | 'TYPE_MISMATCH'
  | 'UNKNOWN_IDENTIFIER'
  | 'TACTIC_FAILED'
  | 'UNSOLVED_GOALS'
  | 'TIMEOUT'
  | 'KERNEL_ERROR'
  | 'SYNTAX_ERROR'
  | 'OTHER'

export type Range = {
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

export type GoalSnapshot = {
  before: string
  after: string | null
  tactic: string
  appliedLemmas: string[]
  subgoalsCreated: number
}

export type NodeStatus = {
  kind: StatusKind
  errorMessage: string | null
  errorCategory: ErrorCategory | null
}

export type ProofNode = {
  id: string
  kind: NodeKind
  label: string
  leanRange: Range
  goalCurrent: string | null
  goalSnapshots: GoalSnapshot[]
  estimatedDistance: number | null
  status: NodeStatus
  children: string[]
  dependencies: string[]
}

export type ProofProgress = {
  totalGoals: number
  resolvedGoals: number
  blockedGoals: number
  sorryGoals: number
  estimatedRemaining: number | null
}

export type ProofDAG = {
  fileUri: string
  rootIds: string[]
  nodes: Record<string, ProofNode>
  extractedAt: number
  progress: ProofProgress | null
}

export type FileState = {
  fileUri: string
  dag: ProofDAG | null
  lastSyncedAt: number | null
}

export type SorryItem = {
  nodeId: string
  label: string
  goalText: string
  dependentCount: number
  estimatedDifficulty: number
}

export type SorryQueue = {
  items: SorryItem[]
  totalSorries: number
}

export type Diagnosis = {
  nodeId: string
  errorCategory: ErrorCategory
  rawMessage: string
  expected: string | null
  actual: string | null
  mismatchPath: string | null
  hint: string | null
  suggestedTactic: string | null
}

export type BreakageEdge = {
  changedNodeId: string
  brokenNodeId: string
  errorCategory: ErrorCategory
  errorMessage: string | null
}

export type BreakageMap = {
  edges: BreakageEdge[]
  lastAnalyzedAt: number | null
}

export type ProofFlowState = {
  appVersion: string
  files: Record<string, FileState>
  activeFileUri: string | null
  selectedNodeId: string | null
  cursorNodeId: string | null
  panelVisible: boolean
  sorryQueue: SorryQueue | null
  breakageMap: BreakageMap | null
  activeDiagnosis: Diagnosis | null
}
