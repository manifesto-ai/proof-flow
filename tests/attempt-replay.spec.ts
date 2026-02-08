import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { App } from '@manifesto-ai/app'
import type { Snapshot, WorldId } from '@manifesto-ai/app'
import type { ProofFlowState } from '@proof-flow/schema'
import { createAttemptRecordEffect } from '../packages/host/src/effects/attempt-record.js'
import { createProofFlowApp } from '../packages/app/src/config.js'
import {
  createProofFlowWorld,
  createProofFlowWorldStore
} from '../packages/app/src/worldstore.js'

const domainMelPromise = readFile(
  new URL('../packages/schema/domain.mel', import.meta.url),
  'utf8'
)

const tempDirs: string[] = []
const apps: App[] = []

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Attempt replay and restore', () => {
  it('restores attempt history/patterns after app restart', async () => {
    const schema = await domainMelPromise
    const rootPath = await mkdtemp(join(tmpdir(), 'proof-flow-attempt-replay-'))
    tempDirs.push(rootPath)

    const fileUri = 'file:///proof.lean'
    const nodeId = 'root'
    const worldA = await createProofFlowWorld({
      world: { rootPath }
    })

    const appA = createProofFlowApp({
      schema,
      world: worldA,
      effects: {
        'proof_flow.dag.extract': async () => [],
        'proof_flow.editor.reveal': async () => [],
        'proof_flow.attempt.suggest': async () => [],
        'proof_flow.attempt.record': createAttemptRecordEffect({
          now: () => 1700000000000,
          createAttemptId: ({ sequence }) => `attempt-${sequence}`
        })
      }
    })
    apps.push(appA)
    await appA.ready()

    await appA.act('attempt_record', {
      fileUri,
      nodeId,
      tactic: 'simp',
      tacticKey: 'simp',
      result: 'error',
      contextErrorCategory: 'TACTIC_FAILED',
      errorMessage: 'simp failed',
      durationMs: 15
    }).done()

    const headAfterAttempt = appA.getCurrentHead?.()
    const firstState = appA.getState<ProofFlowState>().data

    expect(firstState.history.files[fileUri]?.nodes[nodeId]?.totalAttempts).toBe(1)
    expect(firstState.patterns.totalAttempts).toBe(1)
    expect(firstState.patterns.entries['TACTIC_FAILED:simp']?.failureCount).toBe(1)

    await appA.dispose()
    apps.splice(apps.indexOf(appA), 1)

    // File-backed world persistence is async.
    await delay(40)

    expect(headAfterAttempt).toBeDefined()
    const restoredStore = await createProofFlowWorldStore({ rootPath })

    expect(await restoredStore.has(headAfterAttempt as WorldId)).toBe(true)

    const lineage = await restoredStore.getLineage?.(headAfterAttempt as WorldId)
    expect(lineage?.[0]).toBe(headAfterAttempt)

    const snapshot = await restoredStore.restore(headAfterAttempt as WorldId) as Snapshot
    const restoredData = snapshot.data as ProofFlowState

    expect(restoredData.history.files[fileUri]?.nodes[nodeId]?.totalAttempts).toBe(1)
    expect(restoredData.history.files[fileUri]?.nodes[nodeId]?.attempts['attempt-1']).toBeDefined()
    expect(restoredData.patterns.totalAttempts).toBe(1)
    expect(restoredData.patterns.entries['TACTIC_FAILED:simp']?.failureCount).toBe(1)
  })
})
