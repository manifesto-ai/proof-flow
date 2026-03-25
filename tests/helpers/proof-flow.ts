import { readFile } from 'node:fs/promises'
import {
  createIntent,
  createManifesto,
  defineOps,
  dispatchAsync,
  type EffectHandler,
  type ManifestoInstance,
  type Snapshot
} from '@manifesto-ai/sdk'
import { createProofFlowRuntime, type ProofFlowRuntime } from '../../packages/app/src/runtime.js'
import type { ProofFlowState } from '../../packages/schema/src/index.js'

export type ProofFlowSnapshotData = ProofFlowState & Record<string, unknown>

const domainMelPromise = readFile(
  new URL('../../packages/schema/domain.mel', import.meta.url),
  'utf8'
)

let intentSequence = 0

export const proofFlowOps = defineOps<ProofFlowState>()

export const createTestManifesto = async (
  effects: Record<string, EffectHandler>,
  snapshot?: Snapshot<ProofFlowSnapshotData>
): Promise<ManifestoInstance<ProofFlowSnapshotData>> => {
  const schema = await domainMelPromise
  return createManifesto<ProofFlowSnapshotData>({
    schema,
    effects,
    snapshot
  })
}

export const createTestRuntime = async (
  effects: Record<string, EffectHandler>
): Promise<ProofFlowRuntime> => {
  const schema = await domainMelPromise
  return createProofFlowRuntime({
    schema,
    effects
  })
}

export const dispatchAction = async (
  manifesto: ManifestoInstance<ProofFlowSnapshotData>,
  type: string,
  input?: unknown
): Promise<Snapshot<ProofFlowSnapshotData>> => {
  intentSequence += 1
  const intentId = `test-intent-${intentSequence}`
  const intent = input === undefined
    ? createIntent(type, intentId)
    : createIntent(type, input, intentId)

  return dispatchAsync(manifesto, intent)
}
