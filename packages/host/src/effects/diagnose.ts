import type { ErrorCategory } from '@proof-flow/schema'
import {
  asRecord,
  getSnapshotData,
  type EffectPatch,
  type HostEffectHandler
} from './types.js'

export type DiagnoseInput = {
  fileUri: string
  nodeId: string
}

export type CreateDiagnoseEffectOptions = {
  now?: () => number
}

const ERROR_CATEGORIES = new Set<ErrorCategory>([
  'TYPE_MISMATCH',
  'UNKNOWN_IDENTIFIER',
  'TACTIC_FAILED',
  'UNSOLVED_GOALS',
  'TIMEOUT',
  'KERNEL_ERROR',
  'SYNTAX_ERROR',
  'OTHER'
])

const asString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
)

const parseErrorCategory = (value: unknown): ErrorCategory | null => (
  typeof value === 'string' && ERROR_CATEGORIES.has(value as ErrorCategory)
    ? value as ErrorCategory
    : null
)

const parseInput = (params: unknown): DiagnoseInput | null => {
  const record = asRecord(params)
  if (!record) {
    return null
  }

  const fileUri = asString(record.fileUri)
  const nodeId = asString(record.nodeId)
  if (!fileUri || !nodeId) {
    return null
  }

  return { fileUri, nodeId }
}

const extractPair = (
  message: string,
  key: 'expected' | 'actual'
): string | null => {
  const regex = new RegExp(`${key}\\s*:?\\s*([^\\n]+)`, 'i')
  const matched = message.match(regex)
  return matched?.[1]?.trim() ?? null
}

const extractMismatchPath = (message: string): string | null => {
  const argumentMatch = message.match(/at\\s+(argument\\s+\\d+[^\\n]*)/i)
  if (argumentMatch?.[1]) {
    return argumentMatch[1].trim()
  }

  const pathMatch = message.match(/in\\s+([^\\n]+)$/i)
  return pathMatch?.[1]?.trim() ?? null
}

const toHint = (
  category: ErrorCategory,
  expected: string | null,
  actual: string | null
): string | null => {
  if (category === 'TYPE_MISMATCH' && expected && actual) {
    return `Expected ${expected}, but got ${actual}. Check the current goal and local hypotheses.`
  }

  if (category === 'UNKNOWN_IDENTIFIER') {
    return 'Check spelling, open namespaces, and whether the identifier is available in local context.'
  }

  if (category === 'UNSOLVED_GOALS') {
    return 'Try `cases`, `constructor`, or `refine` to split the goal into smaller subgoals.'
  }

  if (category === 'TACTIC_FAILED') {
    return 'Try a narrower tactic or provide explicit arguments to avoid broad tactic failure.'
  }

  return null
}

const toSuggestedTactic = (
  category: ErrorCategory,
  message: string
): string | null => {
  if (category === 'UNSOLVED_GOALS') {
    return 'cases'
  }

  if (category === 'TYPE_MISMATCH' && /\\bih\\b/i.test(message)) {
    return 'exact ih'
  }

  return null
}

const clearDiagnosisPatch = (): EffectPatch => ({
  op: 'set',
  path: 'activeDiagnosis',
  value: null
})

export const createDiagnoseEffect = (
  _options: CreateDiagnoseEffectOptions = {}
): HostEffectHandler => async (params, ctx) => {
  const input = parseInput(params)
  if (!input) {
    return [clearDiagnosisPatch()]
  }

  const snapshotData = getSnapshotData(ctx)
  const files = asRecord(snapshotData.files)
  const file = asRecord(files?.[input.fileUri])
  const dag = asRecord(file?.dag)
  const nodes = asRecord(dag?.nodes)
  const node = asRecord(nodes?.[input.nodeId])
  const status = asRecord(node?.status)
  const errorCategory = parseErrorCategory(status?.errorCategory) ?? 'OTHER'
  const rawMessage = asString(status?.errorMessage)

  if (!rawMessage) {
    return [clearDiagnosisPatch()]
  }

  const expected = extractPair(rawMessage, 'expected')
  const actual = extractPair(rawMessage, 'actual')
  const mismatchPath = extractMismatchPath(rawMessage)

  return [{
    op: 'set',
    path: 'activeDiagnosis',
    value: {
      nodeId: input.nodeId,
      errorCategory,
      rawMessage,
      expected,
      actual,
      mismatchPath,
      hint: toHint(errorCategory, expected, actual),
      suggestedTactic: toSuggestedTactic(errorCategory, rawMessage)
    }
  }]
}
