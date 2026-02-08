import type {
  AttemptRecord,
  AttemptResult,
  ErrorCategory
} from '@proof-flow/schema'
import {
  asRecord,
  getSnapshotData,
  type EffectPatch,
  type HostEffectHandler
} from './types.js'

export type AttemptRecordInput = {
  fileUri: string
  nodeId: string
  tactic: string
  tacticKey: string
  result: AttemptResult
  contextErrorCategory: ErrorCategory | null
  errorMessage: string | null
  durationMs: number | null
}

export type CreateAttemptRecordEffectOptions = {
  now?: () => number
  createAttemptId?: (input: {
    timestamp: number
    fileUri: string
    nodeId: string
    tacticKey: string
    sequence: number
  }) => string
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

const asNumber = (value: unknown, fallback = 0): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
)

const asNullableNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
)

const parseErrorCategory = (value: unknown): ErrorCategory | null => (
  typeof value === 'string' && ERROR_CATEGORIES.has(value as ErrorCategory)
    ? value as ErrorCategory
    : null
)

const parseAttemptResult = (value: unknown): AttemptResult | null => (
  typeof value === 'string' && ATTEMPT_RESULTS.has(value as AttemptResult)
    ? value as AttemptResult
    : null
)

const parseInput = (params: unknown): AttemptRecordInput | null => {
  const record = asRecord(params)
  if (!record) {
    return null
  }

  const fileUri = asString(record.fileUri)
  const nodeId = asString(record.nodeId)
  const tactic = asString(record.tactic)
  const tacticKey = asString(record.tacticKey)
  const result = parseAttemptResult(record.result)

  if (!fileUri || !nodeId || !tactic || !tacticKey || !result) {
    return null
  }

  return {
    fileUri,
    nodeId,
    tactic,
    tacticKey,
    result,
    contextErrorCategory: parseErrorCategory(record.contextErrorCategory),
    errorMessage: asNullableString(record.errorMessage),
    durationMs: asNullableNumber(record.durationMs)
  }
}

const asHistoryState = (snapshot: Record<string, unknown>): {
  version: string
  files: Record<string, unknown>
} => {
  const history = asRecord(snapshot.history)
  const files = asRecord(history?.files)

  return {
    version: typeof history?.version === 'string' ? history.version : '0.2.0',
    files: files ?? {}
  }
}

const asPatternsState = (snapshot: Record<string, unknown>): {
  version: string
  entries: Record<string, unknown>
  totalAttempts: number
  updatedAt: number | null
} => {
  const patterns = asRecord(snapshot.patterns)
  const entries = asRecord(patterns?.entries)

  return {
    version: typeof patterns?.version === 'string' ? patterns.version : '0.3.0',
    entries: entries ?? {},
    totalAttempts: asNumber(patterns?.totalAttempts),
    updatedAt: asNullableNumber(patterns?.updatedAt)
  }
}

const createDefaultAttemptId = (input: {
  timestamp: number
  sequence: number
}): string => `${input.timestamp}:${input.sequence}`

const toHistoryPatchValue = (
  snapshotData: Record<string, unknown>,
  input: AttemptRecordInput,
  timestamp: number,
  attemptId: string
): Record<string, unknown> => {
  const previousHistory = asHistoryState(snapshotData)
  const previousFile = asRecord(previousHistory.files[input.fileUri])
  const previousNodes = asRecord(previousFile?.nodes) ?? {}
  const previousNode = asRecord(previousNodes[input.nodeId])
  const previousAttempts = asRecord(previousNode?.attempts) ?? {}

  const previousNodeTotal = asNumber(previousNode?.totalAttempts)
  const previousFileTotal = asNumber(previousFile?.totalAttempts)
  const previousStreak = asNumber(previousNode?.currentStreak)

  const isSuccess = input.result === 'success'
  const record: AttemptRecord = {
    id: attemptId,
    fileUri: input.fileUri,
    nodeId: input.nodeId,
    timestamp,
    tactic: input.tactic,
    tacticKey: input.tacticKey,
    result: input.result,
    contextErrorCategory: input.contextErrorCategory,
    errorMessage: input.errorMessage,
    durationMs: input.durationMs
  }

  const nextNode = {
    ...(previousNode ?? {}),
    nodeId: input.nodeId,
    attempts: {
      ...previousAttempts,
      [attemptId]: record
    },
    currentStreak: isSuccess ? 0 : previousStreak + 1,
    totalAttempts: previousNodeTotal + 1,
    lastAttemptAt: timestamp,
    lastSuccessAt: isSuccess ? timestamp : asNullableNumber(previousNode?.lastSuccessAt),
    lastFailureAt: isSuccess ? asNullableNumber(previousNode?.lastFailureAt) : timestamp
  }

  const nextFile = {
    ...(previousFile ?? {}),
    fileUri: input.fileUri,
    nodes: {
      ...previousNodes,
      [input.nodeId]: nextNode
    },
    totalAttempts: previousFileTotal + 1,
    updatedAt: timestamp
  }

  return {
    version: previousHistory.version,
    files: {
      ...previousHistory.files,
      [input.fileUri]: nextFile
    }
  }
}

const toPatternsPatchValue = (
  snapshotData: Record<string, unknown>,
  input: AttemptRecordInput,
  timestamp: number
): Record<string, unknown> => {
  const previousPatterns = asPatternsState(snapshotData)
  const errorCategory = input.contextErrorCategory ?? 'OTHER'
  const key = `${errorCategory}:${input.tacticKey}`
  const previousEntry = asRecord(previousPatterns.entries[key])
  const previousSuccessCount = asNumber(previousEntry?.successCount)
  const previousFailureCount = asNumber(previousEntry?.failureCount)
  const nextSuccessCount = previousSuccessCount + (input.result === 'success' ? 1 : 0)
  const nextFailureCount = previousFailureCount + (input.result === 'success' ? 0 : 1)
  const total = nextSuccessCount + nextFailureCount

  const nextEntry = {
    ...(previousEntry ?? {}),
    key,
    errorCategory,
    tacticKey: input.tacticKey,
    successCount: nextSuccessCount,
    failureCount: nextFailureCount,
    score: total > 0 ? nextSuccessCount / total : 0,
    lastUpdated: timestamp,
    dagFingerprint: asNullableString(previousEntry?.dagFingerprint),
    dagClusterId: asNullableString(previousEntry?.dagClusterId),
    goalSignature: asNullableString(previousEntry?.goalSignature)
  }

  return {
    version: previousPatterns.version,
    entries: {
      ...previousPatterns.entries,
      [key]: nextEntry
    },
    totalAttempts: previousPatterns.totalAttempts + 1,
    updatedAt: timestamp
  }
}

export const createAttemptRecordEffect = (
  options: CreateAttemptRecordEffectOptions = {}
): HostEffectHandler => async (params, ctx) => {
  const input = parseInput(params)
  if (!input) {
    return []
  }

  const snapshotData = getSnapshotData(ctx)
  const timestamp = options.now?.() ?? Date.now()

  const historyState = asHistoryState(snapshotData)
  const previousFile = asRecord(historyState.files[input.fileUri])
  const previousNodes = asRecord(previousFile?.nodes) ?? {}
  const previousNode = asRecord(previousNodes[input.nodeId])
  const sequence = asNumber(previousNode?.totalAttempts) + 1
  const attemptId = options.createAttemptId?.({
    timestamp,
    fileUri: input.fileUri,
    nodeId: input.nodeId,
    tacticKey: input.tacticKey,
    sequence
  }) ?? createDefaultAttemptId({ timestamp, sequence })

  const patches: EffectPatch[] = [
    {
      op: 'set',
      path: 'history',
      value: toHistoryPatchValue(snapshotData, input, timestamp, attemptId)
    },
    {
      op: 'set',
      path: 'patterns',
      value: toPatternsPatchValue(snapshotData, input, timestamp)
    }
  ]

  return patches
}
