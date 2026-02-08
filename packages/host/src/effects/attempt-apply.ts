import type {
  AttemptResult,
  ErrorCategory
} from '@proof-flow/schema'
import {
  asRecord,
  getSnapshotData,
  type HostEffectHandler
} from './types.js'
import {
  buildAttemptRecordPatches,
  type CreateAttemptRecordEffectOptions
} from './attempt-record.js'

export type AttemptApplyInput = {
  fileUri: string
  nodeId: string
  tactic: string
  tacticKey: string
  contextErrorCategory: ErrorCategory | null
  errorMessage: string | null
}

export type AttemptApplyRunnerInput = {
  fileUri: string
  nodeId: string
  tactic: string
  tacticKey: string
}

export type AttemptApplyRunnerResult = {
  applied: boolean
  result?: AttemptResult
  contextErrorCategory?: ErrorCategory | null
  errorMessage?: string | null
  durationMs?: number | null
}

export type CreateAttemptApplyEffectOptions = {
  apply?: (input: AttemptApplyRunnerInput) => Promise<AttemptApplyRunnerResult>
  now?: CreateAttemptRecordEffectOptions['now']
  createAttemptId?: CreateAttemptRecordEffectOptions['createAttemptId']
}

const ATTEMPT_RESULTS = new Set<AttemptResult>([
  'success',
  'error',
  'timeout',
  'placeholder'
])

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
  typeof value === 'string' && value.length > 0 ? value : null
)

const asNullableString = (value: unknown): string | null => (
  typeof value === 'string' ? value : null
)

const asNullableNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
)

const parseAttemptResult = (value: unknown): AttemptResult | null => (
  typeof value === 'string' && ATTEMPT_RESULTS.has(value as AttemptResult)
    ? value as AttemptResult
    : null
)

const parseErrorCategory = (value: unknown): ErrorCategory | null => (
  typeof value === 'string' && ERROR_CATEGORIES.has(value as ErrorCategory)
    ? value as ErrorCategory
    : null
)

const parseInput = (params: unknown): AttemptApplyInput | null => {
  const record = asRecord(params)
  if (!record) {
    return null
  }

  const fileUri = asString(record.fileUri)
  const nodeId = asString(record.nodeId)
  const tactic = asString(record.tactic)
  const tacticKey = asString(record.tacticKey)

  if (!fileUri || !nodeId || !tactic || !tacticKey) {
    return null
  }

  return {
    fileUri,
    nodeId,
    tactic,
    tacticKey,
    contextErrorCategory: parseErrorCategory(record.contextErrorCategory),
    errorMessage: asNullableString(record.errorMessage)
  }
}

const normalizeRunnerResult = (
  input: AttemptApplyInput,
  runnerResult: AttemptApplyRunnerResult,
  fallbackErrorMessage: string | null
): {
  result: AttemptResult
  contextErrorCategory: ErrorCategory | null
  errorMessage: string | null
  durationMs: number | null
} => {
  const result = parseAttemptResult(runnerResult.result)
    ?? (runnerResult.applied ? 'success' : 'error')

  const contextErrorCategory = parseErrorCategory(runnerResult.contextErrorCategory)
    ?? input.contextErrorCategory

  const defaultErrorMessage = result === 'success'
    ? null
    : fallbackErrorMessage ?? input.errorMessage ?? 'failed to apply tactic'

  return {
    result,
    contextErrorCategory,
    errorMessage: asNullableString(runnerResult.errorMessage) ?? defaultErrorMessage,
    durationMs: asNullableNumber(runnerResult.durationMs)
  }
}

export const createAttemptApplyEffect = (
  options: CreateAttemptApplyEffectOptions = {}
): HostEffectHandler => async (params, ctx) => {
  const input = parseInput(params)
  if (!input || !options.apply) {
    return []
  }

  let runnerResult: AttemptApplyRunnerResult
  let fallbackErrorMessage: string | null = null

  try {
    runnerResult = await options.apply({
      fileUri: input.fileUri,
      nodeId: input.nodeId,
      tactic: input.tactic,
      tacticKey: input.tacticKey
    })
  }
  catch (error) {
    fallbackErrorMessage = error instanceof Error ? error.message : String(error)
    runnerResult = { applied: false }
  }

  const normalized = normalizeRunnerResult(input, runnerResult, fallbackErrorMessage)
  const snapshotData = getSnapshotData(ctx)

  return buildAttemptRecordPatches(snapshotData, {
    fileUri: input.fileUri,
    nodeId: input.nodeId,
    tactic: input.tactic,
    tacticKey: input.tacticKey,
    result: normalized.result,
    contextErrorCategory: normalized.contextErrorCategory,
    errorMessage: normalized.errorMessage,
    durationMs: normalized.durationMs
  }, {
    now: options.now,
    createAttemptId: options.createAttemptId
  })
}
