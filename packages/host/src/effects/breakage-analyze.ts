import type { ErrorCategory } from '@proof-flow/schema'
import {
  asRecord,
  getSnapshotData,
  type HostEffectHandler
} from './types.js'

export type BreakageAnalyzeInput = {
  fileUri?: string
}

export type CreateBreakageAnalyzeEffectOptions = {
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

const parseErrorCategory = (value: unknown): ErrorCategory => (
  typeof value === 'string' && ERROR_CATEGORIES.has(value as ErrorCategory)
    ? value as ErrorCategory
    : 'OTHER'
)

const parseInput = (params: unknown): BreakageAnalyzeInput => {
  const record = asRecord(params)
  return {
    fileUri: asString(record?.fileUri) ?? undefined
  }
}

const getActiveFileUri = (snapshotData: Record<string, unknown>): string | null => {
  return asString(snapshotData.activeFileUri)
}

export const createBreakageAnalyzeEffect = (
  options: CreateBreakageAnalyzeEffectOptions = {}
): HostEffectHandler => async (params, ctx) => {
  const input = parseInput(params)
  const snapshotData = getSnapshotData(ctx)
  const fileUri = input.fileUri ?? getActiveFileUri(snapshotData)
  if (!fileUri) {
    return [{ op: 'set', path: 'breakageMap', value: null }]
  }

  const files = asRecord(snapshotData.files)
  const file = asRecord(files?.[fileUri])
  const dag = asRecord(file?.dag)
  const nodes = asRecord(dag?.nodes)

  if (!nodes) {
    return [{ op: 'set', path: 'breakageMap', value: null }]
  }

  const edges = new Map<string, {
    changedNodeId: string
    brokenNodeId: string
    errorCategory: ErrorCategory
    errorMessage: string | null
  }>()

  const nodeEntries = Object.values(nodes)
    .map((raw) => asRecord(raw))
    .filter((node): node is Record<string, unknown> => node !== null)

  for (const node of nodeEntries) {
    const status = asRecord(node.status)
    const statusKind = asString(status?.kind)
    if (statusKind !== 'error') {
      continue
    }

    const brokenNodeId = asString(node.id)
    if (!brokenNodeId) {
      continue
    }

    const errorCategory = parseErrorCategory(status?.errorCategory)
    const errorMessage = asString(status?.errorMessage)
    const dependencies = Array.isArray(node.dependencies) ? node.dependencies : []

    for (const dependency of dependencies) {
      if (typeof dependency !== 'string' || dependency.length === 0) {
        continue
      }

      const key = `${dependency}->${brokenNodeId}`
      edges.set(key, {
        changedNodeId: dependency,
        brokenNodeId,
        errorCategory,
        errorMessage
      })
    }
  }

  return [{
    op: 'set',
    path: 'breakageMap',
    value: {
      edges: [...edges.values()],
      lastAnalyzedAt: options.now?.() ?? Date.now()
    }
  }]
}
