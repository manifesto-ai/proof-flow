import { deriveLeanState } from '../lean/derive.js'
import type { LeanContext } from '../lean/types.js'
import {
  asRecord,
  type EffectPatch,
  type HostEffectHandler
} from './types.js'

export type CreateLeanSyncGoalsEffectOptions = {
  loadContext: () => Promise<LeanContext | null>
  now?: () => number
}

const parseInto = (params: unknown): string | null => {
  const record = asRecord(params)
  const into = record?.into
  return typeof into === 'string' && into.length > 0 ? into : null
}

const emptyStatePatches = (into: string, now: number): EffectPatch[] => [
  { op: 'set', path: into, value: {} },
  {
    op: 'set',
    path: '$host.leanState',
    value: {
      fileUri: null,
      dag: { nodes: {}, edges: [] },
      goalPositions: {},
      diagnostics: [],
      lastElaboratedAt: now
    }
  }
]

export const createLeanSyncGoalsEffect = (
  options: CreateLeanSyncGoalsEffectOptions
): HostEffectHandler => async (params) => {
  const into = parseInto(params)
  if (!into) {
    return []
  }

  const now = options.now?.() ?? Date.now()
  const context = await options.loadContext()
  if (!context) {
    return emptyStatePatches(into, now)
  }

  const derived = deriveLeanState(context, now)
  return [
    { op: 'set', path: into, value: derived.goals },
    { op: 'set', path: '$host.leanState', value: derived.hostState }
  ]
}
