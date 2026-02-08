import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { App } from '@manifesto-ai/app'
import { createProofFlowApp } from '../packages/app/src/config.js'
import type { ProofFlowState } from '../packages/schema/src/index.js'

const domainMelPromise = readFile(
  new URL('../packages/schema/domain.mel', import.meta.url),
  'utf8'
)

const apps: App[] = []

const createApp = async (): Promise<App> => {
  const schema = await domainMelPromise
  const app = createProofFlowApp({
    schema,
    effects: {
      'proof_flow.dag.extract': async (params) => {
        const fileUri = (params as { fileUri?: string })?.fileUri ?? 'file:///proof.lean'
        return [{
          op: 'merge',
          path: 'files',
          value: {
            [fileUri]: {
              fileUri,
              dag: null,
              lastSyncedAt: 1
            }
          }
        }]
      },
      'proof_flow.editor.reveal': async () => [],
      'proof_flow.editor.getCursor': async () => [],
      'proof_flow.attempt.record': async () => [],
      'proof_flow.attempt.suggest': async () => [],
      'proof_flow.attempt.apply': async () => []
    }
  })

  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('Runtime compliance', () => {
  it('exposes required App interface methods', async () => {
    const app = await createApp()
    await app.ready()

    expect(typeof app.ready).toBe('function')
    expect(typeof app.dispose).toBe('function')
    expect(typeof app.act).toBe('function')
    expect(typeof app.getState).toBe('function')
    expect(typeof app.subscribe).toBe('function')
    expect(typeof app.fork).toBe('function')
    expect(typeof app.currentBranch).toBe('function')
  })

  it('follows lifecycle state machine and processes intents through execution pipeline', async () => {
    const app = await createApp()

    expect(app.status).toBe('created')
    await app.ready()
    expect(app.status).toBe('ready')

    const headBefore = app.getCurrentHead?.()
    await app.act('dag_sync', { fileUri: 'file:///proof.lean' }).done()
    const headAfter = app.getCurrentHead?.()

    expect(headBefore).toBeDefined()
    expect(headAfter).toBeDefined()
    expect(headAfter).not.toBe(headBefore)

    const world = await app.getWorld?.(headAfter!)
    const snapshot = await app.getSnapshot?.(headAfter!)

    expect(world).not.toBeNull()
    expect(snapshot).not.toBeNull()

    const state = app.getState<ProofFlowState>()
    expect(state.data.files['file:///proof.lean']?.lastSyncedAt).toBe(1)

    await app.dispose()
    expect(app.status).toBe('disposed')
  })
})
