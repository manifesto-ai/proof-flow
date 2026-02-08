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
  goal: string | null
  status: NodeStatus
  children: string[]
  dependencies: string[]
}

export type DagMetrics = {
  totalNodes: number
  resolvedCount: number
  errorCount: number
  sorryCount: number
  inProgressCount: number
  maxDepth: number
}

export type ProofDAG = {
  fileUri: string
  rootIds: string[]
  nodes: Record<string, ProofNode>
  extractedAt: number
  metrics: DagMetrics | null
}

export type FileState = {
  fileUri: string
  dag: ProofDAG | null
  lastSyncedAt: number | null
}

export type LayoutDirection = 'topDown' | 'leftRight'

export type UiState = {
  panelVisible: boolean
  activeFileUri: string | null
  selectedNodeId: string | null
  cursorNodeId: string | null
  layout: LayoutDirection
  zoom: number
  collapseResolved: boolean
}

export type AttemptResult = 'success' | 'error' | 'timeout' | 'placeholder'

export type AttemptRecord = {
  id: string
  fileUri: string
  nodeId: string
  timestamp: number
  tactic: string
  tacticKey: string
  result: AttemptResult
  contextErrorCategory: ErrorCategory | null
  errorMessage: string | null
  durationMs: number | null
}

export type NodeHistory = {
  nodeId: string
  attempts: Record<string, AttemptRecord>
  currentStreak: number
  totalAttempts: number
  lastAttemptAt: number | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
}

export type FileHistory = {
  fileUri: string
  nodes: Record<string, NodeHistory>
  totalAttempts: number
  updatedAt: number | null
}

export type HistoryState = {
  version: string
  files: Record<string, FileHistory>
}

export type PatternEntry = {
  key: string
  errorCategory: ErrorCategory
  tacticKey: string
  successCount: number
  failureCount: number
  score: number
  lastUpdated: number
  dagFingerprint: string | null
  dagClusterId: string | null
  goalSignature: string | null
}

export type PatternsState = {
  version: string
  entries: Record<string, PatternEntry>
  totalAttempts: number
  updatedAt: number | null
}

export type ProofFlowState = {
  appVersion: string
  files: Record<string, FileState>
  ui: UiState
  history: HistoryState
  patterns: PatternsState
}
