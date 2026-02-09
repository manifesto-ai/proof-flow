import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { App } from '@manifesto-ai/app'
import type { ProofFlowState } from '@proof-flow/schema'
import { createProofFlowApp } from '../packages/app/src/config.js'

const domainMelPromise = readFile(
  new URL('../packages/schema/domain.mel', import.meta.url),
  'utf8'
)

const apps: App[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('ProofFlow app config', () => {
  it('initializes v2 root fields and runs syncGoals', async () => {
    const schema = await domainMelPromise

    const app = createProofFlowApp({
      schema,
      effects: {
        'lean.syncGoals': async (params) => {
          const into = (params as { into: string }).into
          return [{
            op: 'set',
            path: into,
            value: {
              g1: { id: 'g1', statement: '⊢ True', status: 'open' }
            }
          }]
        },
        'lean.applyTactic': async () => []
      }
    })

    await app.ready()
    apps.push(app)

    await app.act('syncGoals').done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.goals.g1?.status).toBe('open')
    expect(state.data.activeGoalId).toBeNull()
    expect(state.data.lastTactic).toBeNull()
    expect(state.data.tacticResult).toBeNull()
  })
})
