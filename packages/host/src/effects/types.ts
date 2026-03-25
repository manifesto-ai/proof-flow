import { defineOps, type EffectContext, type EffectHandler, type Patch } from '@manifesto-ai/sdk'
import type { ProofFlowState } from '@proof-flow/schema'

export type EffectPatch = Patch
export type HostEffectHandler = EffectHandler
export type ProofFlowEffectContext = EffectContext<ProofFlowState & Record<string, unknown>>

export const proofFlowOps = defineOps<ProofFlowState>()

export type EffectSnapshotLike = {
  data?: Record<string, unknown>
}

export type EffectContextLike = {
  snapshot?: EffectSnapshotLike
}

export const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

export const getSnapshotData = (ctx: ProofFlowEffectContext | unknown): Record<string, unknown> => {
  const context = asRecord(ctx)
  const snapshot = context ? asRecord(context.snapshot) : null
  const data = snapshot ? asRecord(snapshot.data) : null
  return data ?? {}
}
