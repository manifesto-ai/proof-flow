import { deriveLeanState } from '../lean/derive.js'
import type { LeanContext } from '../lean/types.js'
import {
  asRecord,
  type HostEffectHandler,
  proofFlowOps
} from './types.js'

export type CreateLeanSyncGoalsEffectOptions = {
  loadContext: () => Promise<LeanContext | null>
  now?: () => number
}

const parseInto = (params: unknown): 'goals' | null => {
  const record = asRecord(params)
  const into = record?.into
  return into === 'goals' ? 'goals' : null
}

const emptyStatePatches = (_into: 'goals', now: number) => [
  proofFlowOps.set('goals', {}),
  proofFlowOps.raw.set('$host.leanState', {
    fileUri: null,
    dag: { nodes: {}, edges: [] },
    goalPositions: {},
    diagnostics: [],
    lastElaboratedAt: now
  })
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
    proofFlowOps.set('goals', derived.goals),
    proofFlowOps.raw.set('$host.leanState', derived.hostState)
  ]
}
