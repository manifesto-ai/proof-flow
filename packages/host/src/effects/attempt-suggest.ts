import type {
  ErrorCategory
} from '@proof-flow/schema'
import {
  asRecord,
  getSnapshotData,
  type EffectPatch,
  type HostEffectHandler
} from './types.js'

export type AttemptSuggestInput = {
  fileUri: string
  nodeId: string
}

export type CreateAttemptSuggestEffectOptions = {
  now?: () => number
  limit?: number
  minSampleSize?: number
}

type SuggestionCandidate = {
  tacticKey: string
  sourceCategory: ErrorCategory
  successCount: number
  failureCount: number
  sampleSize: number
  score: number
}

type EffectSuggestionEntry = {
  nodeId: string
  tacticKey: string
  score: number
  sampleSize: number
  successRate: number
  sourceCategory: ErrorCategory | null
  generatedAt: number
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
  typeof value === 'string' && value.length > 0 ? value : null
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

const parseInput = (params: unknown): AttemptSuggestInput | null => {
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

const asHistoryState = (snapshot: Record<string, unknown>): {
  files: Record<string, unknown>
} => {
  const history = asRecord(snapshot.history)
  return {
    files: asRecord(history?.files) ?? {}
  }
}

const asPatternsState = (snapshot: Record<string, unknown>): {
  entries: Record<string, unknown>
} => {
  const patterns = asRecord(snapshot.patterns)
  return {
    entries: asRecord(patterns?.entries) ?? {}
  }
}

const asSuggestionsState = (snapshot: Record<string, unknown>): {
  version: string
  byNode: Record<string, unknown>
} => {
  const suggestions = asRecord(snapshot.suggestions)
  return {
    version: typeof suggestions?.version === 'string' ? suggestions.version : '0.4.0',
    byNode: asRecord(suggestions?.byNode) ?? {}
  }
}

const toPatternCandidates = (
  snapshotData: Record<string, unknown>
): SuggestionCandidate[] => {
  const patterns = asPatternsState(snapshotData)

  return Object.values(patterns.entries)
    .map((entryRaw): SuggestionCandidate | null => {
      const entry = asRecord(entryRaw)
      if (!entry) {
        return null
      }

      const tacticKey = asString(entry.tacticKey)
      const sourceCategory = parseErrorCategory(entry.errorCategory)
      if (!tacticKey || !sourceCategory) {
        return null
      }

      const successCount = asNumber(entry.successCount)
      const failureCount = asNumber(entry.failureCount)
      const sampleSize = successCount + failureCount
      const score = asNumber(entry.score, sampleSize > 0 ? successCount / sampleSize : 0)

      return {
        tacticKey,
        sourceCategory,
        successCount,
        failureCount,
        sampleSize,
        score
      }
    })
    .filter((entry): entry is SuggestionCandidate => entry !== null)
}

const toHistoryCandidates = (
  snapshotData: Record<string, unknown>,
  input: AttemptSuggestInput
): SuggestionCandidate[] => {
  const history = asHistoryState(snapshotData)
  const file = asRecord(history.files[input.fileUri])
  const nodes = asRecord(file?.nodes)
  const node = asRecord(nodes?.[input.nodeId])
  const attempts = asRecord(node?.attempts)
  if (!attempts) {
    return []
  }

  const aggregate = new Map<string, {
    tacticKey: string
    sourceCategory: ErrorCategory
    successCount: number
    failureCount: number
  }>()

  for (const attemptRaw of Object.values(attempts)) {
    const attempt = asRecord(attemptRaw)
    if (!attempt) {
      continue
    }

    const tacticKey = asString(attempt.tacticKey)
    if (!tacticKey) {
      continue
    }

    const sourceCategory = parseErrorCategory(attempt.contextErrorCategory) ?? 'OTHER'
    const result = asString(attempt.result)
    const key = `${sourceCategory}:${tacticKey}`

    const prev = aggregate.get(key) ?? {
      tacticKey,
      sourceCategory,
      successCount: 0,
      failureCount: 0
    }

    if (result === 'success') {
      prev.successCount += 1
    }
    else {
      prev.failureCount += 1
    }

    aggregate.set(key, prev)
  }

  return Array.from(aggregate.values()).map((entry) => {
    const sampleSize = entry.successCount + entry.failureCount
    return {
      ...entry,
      sampleSize,
      score: sampleSize > 0 ? entry.successCount / sampleSize : 0
    }
  })
}

const resolveSourceCategory = (
  snapshotData: Record<string, unknown>,
  input: AttemptSuggestInput
): ErrorCategory | null => {
  const files = asRecord(snapshotData.files)
  const file = asRecord(files?.[input.fileUri])
  const dag = asRecord(file?.dag)
  const nodes = asRecord(dag?.nodes)
  const node = asRecord(nodes?.[input.nodeId])
  const status = asRecord(node?.status)
  const fromDag = parseErrorCategory(status?.errorCategory)
  if (fromDag) {
    return fromDag
  }

  const history = asHistoryState(snapshotData)
  const historyFile = asRecord(history.files[input.fileUri])
  const historyNodes = asRecord(historyFile?.nodes)
  const historyNode = asRecord(historyNodes?.[input.nodeId])
  const attempts = asRecord(historyNode?.attempts)
  if (!attempts) {
    return null
  }

  let latestCategory: ErrorCategory | null = null
  let latestTimestamp = -1
  for (const attemptRaw of Object.values(attempts)) {
    const attempt = asRecord(attemptRaw)
    if (!attempt) {
      continue
    }

    const timestamp = asNullableNumber(attempt.timestamp)
    if (timestamp === null || timestamp < latestTimestamp) {
      continue
    }

    latestTimestamp = timestamp
    latestCategory = parseErrorCategory(attempt.contextErrorCategory)
  }

  return latestCategory
}

const toSuggestionEntries = (
  candidates: SuggestionCandidate[],
  input: AttemptSuggestInput,
  sourceCategory: ErrorCategory | null,
  generatedAt: number,
  minSampleSize: number,
  limit: number
): EffectSuggestionEntry[] => {
  const sorted = candidates
    .filter((entry) => entry.sampleSize >= minSampleSize)
    .slice()
    .sort((left, right) => {
      const leftRank = sourceCategory && left.sourceCategory === sourceCategory ? 0 : 1
      const rightRank = sourceCategory && right.sourceCategory === sourceCategory ? 0 : 1
      if (leftRank !== rightRank) {
        return leftRank - rightRank
      }

      if (left.score !== right.score) {
        return right.score - left.score
      }

      if (left.sampleSize !== right.sampleSize) {
        return right.sampleSize - left.sampleSize
      }

      if (left.tacticKey !== right.tacticKey) {
        return left.tacticKey.localeCompare(right.tacticKey)
      }

      return left.sourceCategory.localeCompare(right.sourceCategory)
    })

  return sorted
    .slice(0, Math.max(limit, 0))
    .map((entry) => ({
      nodeId: input.nodeId,
      tacticKey: entry.tacticKey,
      score: entry.score,
      sampleSize: entry.sampleSize,
      successRate: entry.sampleSize > 0 ? entry.successCount / entry.sampleSize : 0,
      sourceCategory: entry.sourceCategory,
      generatedAt
    }))
}

export const createAttemptSuggestEffect = (
  options: CreateAttemptSuggestEffectOptions = {}
): HostEffectHandler => async (params, ctx) => {
  const input = parseInput(params)
  if (!input) {
    return []
  }

  const snapshotData = getSnapshotData(ctx)
  const generatedAt = options.now?.() ?? Date.now()
  const minSampleSize = options.minSampleSize ?? 3
  const limit = options.limit ?? 5
  const sourceCategory = resolveSourceCategory(snapshotData, input)
  const patternCandidates = toPatternCandidates(snapshotData)
  const existingKeys = new Set(patternCandidates.map((entry) => `${entry.sourceCategory}:${entry.tacticKey}`))
  const historyOnlyCandidates = toHistoryCandidates(snapshotData, input)
    .filter((entry) => !existingKeys.has(`${entry.sourceCategory}:${entry.tacticKey}`))
  const entries = toSuggestionEntries(
    [...patternCandidates, ...historyOnlyCandidates],
    input,
    sourceCategory,
    generatedAt,
    minSampleSize,
    limit
  )

  const suggestions = asSuggestionsState(snapshotData)
  const patch: EffectPatch = {
    op: 'set',
    path: 'suggestions',
    value: {
      version: suggestions.version,
      byNode: {
        ...suggestions.byNode,
        [input.nodeId]: entries
      },
      updatedAt: generatedAt
    }
  }

  return [patch]
}
