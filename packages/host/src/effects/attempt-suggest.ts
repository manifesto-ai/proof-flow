import type {
  ErrorCategory
} from '@proof-flow/schema'
import {
  asRecord,
  getSnapshotData,
  type EffectPatch,
  type HostEffectHandler
} from './types.js'
import { toGoalSignature } from './goal-signature.js'

export type AttemptSuggestInput = {
  fileUri: string
  nodeId: string
}

export type CreateAttemptSuggestEffectOptions = {
  now?: () => number
  limit?: number
  minSampleSize?: number
  ttlMs?: number
  maxTrackedNodes?: number
}

type SuggestionCandidate = {
  tacticKey: string
  sourceCategory: ErrorCategory
  successCount: number
  failureCount: number
  sampleSize: number
  score: number
  lastUpdated: number | null
  goalSignature: string | null
  goalMatched: boolean
  nodeLocalSampleSize: number
  nodeLocalSuccessRate: number
  rankingScore: number
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
const RECENCY_WINDOW_MS = 1000 * 60 * 60 * 24 * 7
const DEFAULT_SUGGESTION_TTL_MS = 1000 * 60 * 60
const DEFAULT_MAX_TRACKED_NODES = 120

const asString = (value: unknown): string | null => (
  typeof value === 'string' && value.length > 0 ? value : null
)

const asNumber = (value: unknown, fallback = 0): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
)

const asNullableNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
)

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const toSampleConfidence = (sampleSize: number): number => clamp01(
  Math.log2(Math.max(sampleSize, 0) + 1) / 4
)

const toRecencyScore = (
  timestamp: number | null,
  generatedAt: number
): number => {
  if (timestamp === null) {
    return 0
  }

  const ageMs = Math.max(0, generatedAt - timestamp)
  return clamp01(1 / (1 + (ageMs / RECENCY_WINDOW_MS)))
}

type NodeLocalAggregate = {
  tacticKey: string
  sourceCategory: ErrorCategory
  successCount: number
  failureCount: number
  sampleSize: number
  successRate: number
  lastAttemptAt: number | null
}

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

const asSuggestionEntry = (raw: unknown): EffectSuggestionEntry | null => {
  const entry = asRecord(raw)
  if (!entry) {
    return null
  }

  const nodeId = asString(entry.nodeId)
  const tacticKey = asString(entry.tacticKey)
  if (!nodeId || !tacticKey) {
    return null
  }

  const sourceCategory = parseErrorCategory(entry.sourceCategory)
  return {
    nodeId,
    tacticKey,
    score: asNumber(entry.score),
    sampleSize: asNumber(entry.sampleSize),
    successRate: asNumber(entry.successRate),
    sourceCategory,
    generatedAt: asNumber(entry.generatedAt)
  }
}

const trimSuggestionEntries = (
  entries: readonly EffectSuggestionEntry[],
  generatedAt: number,
  ttlMs: number,
  limit: number
): EffectSuggestionEntry[] => {
  const lowerBound = generatedAt - Math.max(0, ttlMs)
  return entries
    .filter((entry) => entry.generatedAt >= lowerBound)
    .sort((left, right) => {
      if (left.generatedAt !== right.generatedAt) {
        return right.generatedAt - left.generatedAt
      }
      return right.score - left.score
    })
    .slice(0, Math.max(0, limit))
}

const normalizeSuggestionMap = (
  byNodeRaw: Record<string, unknown>,
  generatedAt: number,
  ttlMs: number,
  limit: number,
  maxTrackedNodes: number
): Record<string, EffectSuggestionEntry[]> => {
  const normalizedEntries = Object.entries(byNodeRaw)
    .map(([nodeId, entries]): [string, EffectSuggestionEntry[]] | null => {
      if (!Array.isArray(entries)) {
        return null
      }

      const parsed = entries
        .map((entry) => asSuggestionEntry(entry))
        .filter((entry): entry is EffectSuggestionEntry => entry !== null)
      const kept = trimSuggestionEntries(parsed, generatedAt, ttlMs, limit)
      if (kept.length === 0) {
        return null
      }
      return [nodeId, kept]
    })
    .filter((entry): entry is [string, EffectSuggestionEntry[]] => entry !== null)
    .sort((left, right) => {
      const leftLatest = left[1][0]?.generatedAt ?? 0
      const rightLatest = right[1][0]?.generatedAt ?? 0
      if (leftLatest !== rightLatest) {
        return rightLatest - leftLatest
      }
      return left[0].localeCompare(right[0])
    })
    .slice(0, Math.max(0, maxTrackedNodes))

  return Object.fromEntries(normalizedEntries)
}

const toNodeLocalAggregates = (
  snapshotData: Record<string, unknown>,
  input: AttemptSuggestInput
): NodeLocalAggregate[] => {
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
    lastAttemptAt: number | null
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
    const timestamp = asNullableNumber(attempt.timestamp)
    const key = `${sourceCategory}:${tacticKey}`

    const prev = aggregate.get(key) ?? {
      tacticKey,
      sourceCategory,
      successCount: 0,
      failureCount: 0,
      lastAttemptAt: null
    }

    if (result === 'success') {
      prev.successCount += 1
    }
    else {
      prev.failureCount += 1
    }

    if (timestamp !== null && (prev.lastAttemptAt === null || timestamp > prev.lastAttemptAt)) {
      prev.lastAttemptAt = timestamp
    }

    aggregate.set(key, prev)
  }

  return Array.from(aggregate.values()).map((entry) => {
    const sampleSize = entry.successCount + entry.failureCount
    return {
      ...entry,
      sampleSize,
      successRate: sampleSize > 0 ? entry.successCount / sampleSize : 0
    }
  })
}

const toNodeLocalIndex = (
  aggregates: NodeLocalAggregate[]
): Map<string, NodeLocalAggregate> => {
  const index = new Map<string, NodeLocalAggregate>()
  for (const aggregate of aggregates) {
    index.set(`${aggregate.sourceCategory}:${aggregate.tacticKey}`, aggregate)
  }
  return index
}

const computeRankingScore = (
  input: {
    sourceCategory: ErrorCategory
    score: number
    sampleSize: number
    lastUpdated: number | null
    goalMatched: boolean
    nodeLocalSampleSize: number
    nodeLocalSuccessRate: number
  },
  activeCategory: ErrorCategory | null,
  generatedAt: number
): number => {
  const categoryScore = activeCategory !== null && input.sourceCategory === activeCategory ? 1 : 0
  const sampleConfidence = toSampleConfidence(input.sampleSize)
  const recencyScore = toRecencyScore(input.lastUpdated, generatedAt)
  const nodeLocalConfidence = input.nodeLocalSampleSize > 0
    ? (
        (toSampleConfidence(input.nodeLocalSampleSize) * 0.5)
        + (clamp01(input.nodeLocalSuccessRate) * 0.5)
      )
    : 0

  return clamp01(
    (input.score * 0.45)
    + (categoryScore * 0.2)
    + (sampleConfidence * 0.15)
    + (recencyScore * 0.1)
    + (nodeLocalConfidence * 0.1)
    + (input.goalMatched ? 0.08 : 0)
  )
}

const toPatternCandidates = (
  snapshotData: Record<string, unknown>,
  nodeLocalIndex: Map<string, NodeLocalAggregate>,
  activeCategory: ErrorCategory | null,
  activeGoalSignature: string | null,
  generatedAt: number
): SuggestionCandidate[] => {
  const patterns = asPatternsState(snapshotData)

  return Object.values(patterns.entries)
    .map((entryRaw): SuggestionCandidate | null => {
      const entry = asRecord(entryRaw)
      if (!entry) {
        return null
      }

      const tacticKey = asString(entry.tacticKey)
      const patternCategory = parseErrorCategory(entry.errorCategory)
      if (!tacticKey || !patternCategory) {
        return null
      }

      const successCount = asNumber(entry.successCount)
      const failureCount = asNumber(entry.failureCount)
      const sampleSize = successCount + failureCount
      const score = asNumber(entry.score, sampleSize > 0 ? successCount / sampleSize : 0)
      const lastUpdated = asNullableNumber(entry.lastUpdated)
      const goalSignature = toGoalSignature(entry.goalSignature)
      const goalMatched = (
        activeGoalSignature !== null
        && goalSignature !== null
        && activeGoalSignature === goalSignature
      )
      const local = nodeLocalIndex.get(`${patternCategory}:${tacticKey}`)
      const nodeLocalSampleSize = local?.sampleSize ?? 0
      const nodeLocalSuccessRate = local?.successRate ?? 0
      const rankingScore = computeRankingScore({
        sourceCategory: patternCategory,
        score,
        sampleSize,
        lastUpdated,
        goalMatched,
        nodeLocalSampleSize,
        nodeLocalSuccessRate
      }, activeCategory, generatedAt)

      return {
        tacticKey,
        sourceCategory: patternCategory,
        successCount,
        failureCount,
        sampleSize,
        score,
        lastUpdated,
        goalSignature,
        goalMatched,
        nodeLocalSampleSize,
        nodeLocalSuccessRate,
        rankingScore
      }
    })
    .filter((entry): entry is SuggestionCandidate => entry !== null)
}

const toHistoryCandidates = (
  nodeLocalAggregates: NodeLocalAggregate[],
  sourceCategory: ErrorCategory | null,
  generatedAt: number
): SuggestionCandidate[] => {
  return nodeLocalAggregates.map((entry) => {
    const score = entry.sampleSize > 0 ? entry.successCount / entry.sampleSize : 0
    const rankingScore = computeRankingScore({
      sourceCategory: entry.sourceCategory,
      score,
      sampleSize: entry.sampleSize,
      lastUpdated: entry.lastAttemptAt,
      goalMatched: false,
      nodeLocalSampleSize: entry.sampleSize,
      nodeLocalSuccessRate: entry.successRate
    }, sourceCategory, generatedAt)

    return {
      tacticKey: entry.tacticKey,
      sourceCategory: entry.sourceCategory,
      successCount: entry.successCount,
      failureCount: entry.failureCount,
      sampleSize: entry.sampleSize,
      score,
      lastUpdated: entry.lastAttemptAt,
      goalSignature: null,
      goalMatched: false,
      nodeLocalSampleSize: entry.sampleSize,
      nodeLocalSuccessRate: entry.successRate,
      rankingScore
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

const resolveNodeGoalSignature = (
  snapshotData: Record<string, unknown>,
  input: AttemptSuggestInput
): string | null => {
  const files = asRecord(snapshotData.files)
  const file = asRecord(files?.[input.fileUri])
  const dag = asRecord(file?.dag)
  const nodes = asRecord(dag?.nodes)
  const node = asRecord(nodes?.[input.nodeId])
  return toGoalSignature(node?.goal)
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

      if (left.rankingScore !== right.rankingScore) {
        return right.rankingScore - left.rankingScore
      }

      if (left.score !== right.score) {
        return right.score - left.score
      }

      if (left.sampleSize !== right.sampleSize) {
        return right.sampleSize - left.sampleSize
      }

      if (left.nodeLocalSampleSize !== right.nodeLocalSampleSize) {
        return right.nodeLocalSampleSize - left.nodeLocalSampleSize
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
      score: entry.rankingScore,
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
  const ttlMs = options.ttlMs ?? DEFAULT_SUGGESTION_TTL_MS
  const maxTrackedNodes = options.maxTrackedNodes ?? DEFAULT_MAX_TRACKED_NODES
  const sourceCategory = resolveSourceCategory(snapshotData, input)
  const goalSignature = resolveNodeGoalSignature(snapshotData, input)
  const nodeLocalAggregates = toNodeLocalAggregates(snapshotData, input)
  const nodeLocalIndex = toNodeLocalIndex(nodeLocalAggregates)
  const patternCandidates = toPatternCandidates(
    snapshotData,
    nodeLocalIndex,
    sourceCategory,
    goalSignature,
    generatedAt
  )
  const existingKeys = new Set(patternCandidates.map((entry) => `${entry.sourceCategory}:${entry.tacticKey}`))
  const historyOnlyCandidates = toHistoryCandidates(
    nodeLocalAggregates,
    sourceCategory,
    generatedAt
  )
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
  const byNode = normalizeSuggestionMap(
    suggestions.byNode,
    generatedAt,
    ttlMs,
    limit,
    maxTrackedNodes
  )
  if (entries.length > 0) {
    byNode[input.nodeId] = entries
  }
  else {
    delete byNode[input.nodeId]
  }

  const cappedByNode = normalizeSuggestionMap(
    byNode,
    generatedAt,
    ttlMs,
    limit,
    maxTrackedNodes
  )
  const patch: EffectPatch = {
    op: 'set',
    path: 'suggestions',
    value: {
      version: suggestions.version,
      byNode: cappedByNode,
      updatedAt: generatedAt
    }
  }

  return [patch]
}
