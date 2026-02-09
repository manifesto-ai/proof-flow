import {
  asRecord,
  getSnapshotData,
  type HostEffectHandler
} from './types.js'

export type SorryAnalyzeInput = {
  fileUri?: string
}

export type CreateSorryAnalyzeEffectOptions = {
  now?: () => number
}

const asString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
)

const asNumber = (value: unknown, fallback = 0): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
)

const parseInput = (params: unknown): SorryAnalyzeInput => {
  const record = asRecord(params)
  return {
    fileUri: asString(record?.fileUri) ?? undefined
  }
}

const estimateDifficulty = (goalText: string): number => {
  const lengthScore = Math.min(1, goalText.length / 140)
  return Math.round(lengthScore * 100) / 100
}

const getActiveFileUri = (snapshotData: Record<string, unknown>): string | null => {
  return asString(snapshotData.activeFileUri)
}

export const createSorryAnalyzeEffect = (
  _options: CreateSorryAnalyzeEffectOptions = {}
): HostEffectHandler => async (params, ctx) => {
  const input = parseInput(params)
  const snapshotData = getSnapshotData(ctx)
  const fileUri = input.fileUri ?? getActiveFileUri(snapshotData)
  if (!fileUri) {
    return [{ op: 'set', path: 'sorryQueue', value: null }]
  }

  const files = asRecord(snapshotData.files)
  const file = asRecord(files?.[fileUri])
  const dag = asRecord(file?.dag)
  const nodes = asRecord(dag?.nodes)

  if (!nodes) {
    return [{ op: 'set', path: 'sorryQueue', value: null }]
  }

  const nodeEntries = Object.values(nodes)
    .map((raw) => asRecord(raw))
    .filter((node): node is Record<string, unknown> => node !== null)

  const dependentsByNode = new Map<string, number>()
  for (const node of nodeEntries) {
    const deps = Array.isArray(node.dependencies) ? node.dependencies : []
    for (const dep of deps) {
      if (typeof dep !== 'string') {
        continue
      }
      dependentsByNode.set(dep, (dependentsByNode.get(dep) ?? 0) + 1)
    }
  }

  const items = nodeEntries
    .filter((node) => {
      const status = asRecord(node.status)
      return status?.kind === 'sorry'
    })
    .map((node) => {
      const nodeId = asString(node.id) ?? 'unknown'
      const label = asString(node.label) ?? nodeId
      const goalText = asString(node.goalCurrent) ?? label
      const leanRange = asRecord(node.leanRange)
      const startLine = asNumber(leanRange?.startLine)
      return {
        nodeId,
        label,
        goalText,
        dependentCount: dependentsByNode.get(nodeId) ?? 0,
        estimatedDifficulty: estimateDifficulty(goalText),
        startLine
      }
    })
    .sort((left, right) => {
      if (left.dependentCount !== right.dependentCount) {
        return right.dependentCount - left.dependentCount
      }
      if (left.estimatedDifficulty !== right.estimatedDifficulty) {
        return left.estimatedDifficulty - right.estimatedDifficulty
      }
      if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine
      }
      return left.nodeId.localeCompare(right.nodeId)
    })
    .map(({ startLine: _startLine, ...item }) => item)

  return [{
    op: 'set',
    path: 'sorryQueue',
    value: {
      items,
      totalSorries: items.length
    }
  }]
}
