import type { Goal } from '@proof-flow/schema'

export type LeanDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

export type LeanRange = {
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

export type LeanDiagnostic = {
  message: string
  range: LeanRange
  severity?: LeanDiagnosticSeverity
  source?: string
  code?: string | number
}

export type LeanContext = {
  fileUri: string
  sourceText: string
  diagnostics: readonly LeanDiagnostic[]
}

export type ErrorCategory =
  | 'TYPE_MISMATCH'
  | 'UNKNOWN_IDENTIFIER'
  | 'TACTIC_FAILED'
  | 'UNSOLVED_GOALS'
  | 'TIMEOUT'
  | 'KERNEL_ERROR'
  | 'SYNTAX_ERROR'
  | 'OTHER'

export type LeanDagNodeStatus = 'resolved' | 'error' | 'sorry' | 'in_progress'

export type LeanDagNodeKind =
  | 'theorem'
  | 'lemma'
  | 'example'
  | 'definition'
  | 'diagnostic'

export type LeanDagNode = {
  nodeId: string
  label: string
  kind: LeanDagNodeKind
  startLine: number
  endLine: number
  parentId: string | null
  status: LeanDagNodeStatus
  errorMessage: string | null
  errorCategory: ErrorCategory | null
  goalId: string | null
}

export type LeanDagEdge = {
  source: string
  target: string
}

export type LeanProofDag = {
  nodes: Record<string, LeanDagNode>
  edges: LeanDagEdge[]
}

export type LeanHostState = {
  fileUri: string | null
  dag: LeanProofDag
  goalPositions: Record<string, LeanRange>
  diagnostics: LeanDiagnostic[]
  lastElaboratedAt: number | null
}

export type LeanDerivedState = {
  goals: Record<string, Goal>
  hostState: LeanHostState
}

export type LeanApplyTacticParams = {
  fileUri: string
  goalId: string
  tactic: string
  range: LeanRange | null
}

export type LeanApplyTacticOutcome = {
  succeeded: boolean
  errorMessage?: string
}
