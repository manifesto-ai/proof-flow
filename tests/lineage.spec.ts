import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { App, Effects } from '@manifesto-ai/app'
import type { ProofFlowState } from '../packages/schema/src/index.js'
import { createProofFlowApp } from '../packages/app/src/config.js'

const domainMelPromise = readFile(
  new URL('../packages/schema/domain.mel', import.meta.url),
  'utf8'
)

const apps: App[] = []

const createApp = async (effects: Effects) => {
  const domainMel = await domainMelPromise
  const app = createProofFlowApp({
    schema: domainMel,
    effects
  })

  await app.ready()
  apps.push(app)
  return app
}

const deterministicEffects = (): Effects => ({
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
  'lean.applyTactic': async (params) => {
    const into = (params as { into: string }).into
    return [{
      op: 'set',
      path: into,
      value: {
        goalId: 'g1',
        tactic: 'exact True.intro',
        succeeded: true,
        newGoalIds: []
      }
    }]
  }
})

const stripPlatformState = (data: ProofFlowState & Record<string, unknown>) => {
  const ephemeralKeys = new Set(['applyingTactic', 'resolvingGoal', 'syncingGoals'])
  const entries = Object.entries(data).filter(([key]) => !key.startsWith('$') && !ephemeralKeys.has(key))
  return Object.fromEntries(entries)
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('ProofFlow lineage invariants', () => {
  it('creates retrievable immutable heads as actions commit', async () => {
    const app = await createApp(deterministicEffects())

    if (!app.getCurrentHead || !app.getSnapshot) {
      throw new Error('App lineage APIs are unavailable')
    }

    const head0 = app.getCurrentHead()
    await app.act('syncGoals').done()
    const head1 = app.getCurrentHead()
    await app.act('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }).done()
    const head2 = app.getCurrentHead()
    await app.act('commitTactic').done()
    const head3 = app.getCurrentHead()

    expect(new Set([head0, head1, head2, head3]).size).toBe(4)

    const snapshot1 = await app.getSnapshot(head1)
    const snapshot2 = await app.getSnapshot(head2)
    const snapshot3 = await app.getSnapshot(head3)

    expect(snapshot1.data.goals.g1.status).toBe('open')
    expect(snapshot2.data.tacticResult.succeeded).toBe(true)
    expect(snapshot3.data.tacticResult).toBeNull()
  })

  it('replays same action log into identical domain state', async () => {
    const appA = await createApp(deterministicEffects())
    const appB = await createApp(deterministicEffects())

    for (const app of [appA, appB]) {
      await app.act('syncGoals').done()
      await app.act('selectGoal', { goalId: 'g1' }).done()
      await app.act('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }).done()
      await app.act('commitTactic').done()
    }

    const stateA = appA.getState<ProofFlowState & Record<string, unknown>>()
    const stateB = appB.getState<ProofFlowState & Record<string, unknown>>()
    expect(stripPlatformState(stateA.data)).toEqual(stripPlatformState(stateB.data))
    expect(stateA.computed).toEqual(stateB.computed)
  })
})
