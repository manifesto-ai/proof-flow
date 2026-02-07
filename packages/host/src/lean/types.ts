import type { ErrorCategory, Range, StatusKind } from '@proof-flow/schema'

export type LeanDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

export type LeanDiagnostic = {
  message: string
  range: Range
  severity?: LeanDiagnosticSeverity
  source?: string
  code?: string | number
}

export type LeanContext = {
  fileUri: string
  sourceText: string
  diagnostics: readonly LeanDiagnostic[]
}

export type ParsedDiagnosticNode = {
  id: string
  label: string
  range: Range
  statusKind: StatusKind
  errorCategory: ErrorCategory | null
  errorMessage: string | null
}
