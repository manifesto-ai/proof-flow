import type { HostEffectHandler } from './effects/types.js'
import {
  createLeanApplyTacticEffect,
  type CreateLeanApplyTacticEffectOptions
} from './effects/lean-apply-tactic.js'
import {
  createLeanSyncGoalsEffect,
  type CreateLeanSyncGoalsEffectOptions
} from './effects/lean-sync-goals.js'

export type CreateProofFlowEffectsOptions = {
  syncGoals: CreateLeanSyncGoalsEffectOptions
  applyTactic: CreateLeanApplyTacticEffectOptions
}

export const createProofFlowEffects = (
  options: CreateProofFlowEffectsOptions
): Record<string, HostEffectHandler> => ({
  'lean.syncGoals': createLeanSyncGoalsEffect(options.syncGoals),
  'lean.applyTactic': createLeanApplyTacticEffect(options.applyTactic)
})

export * from './effects/types.js'
export * from './effects/lean-sync-goals.js'
export * from './effects/lean-apply-tactic.js'
export * from './lean/types.js'
export * from './lean/error-category.js'
export * from './lean/derive.js'
