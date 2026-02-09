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

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('ProofFlow v2 domain actions', () => {
  it('syncGoals stores extracted goals', async () => {
    const app = await createApp({
      'lean.syncGoals': async (params) => {
        const into = (params as { into: string }).into
        return [{
          op: 'set',
          path: into,
          value: {
            g1: { id: 'g1', statement: '⊢ True', status: 'open' },
            g2: { id: 'g2', statement: '⊢ False', status: 'failed' }
          }
        }]
      },
      'lean.applyTactic': async () => []
    })

    await app.act('syncGoals').done()

    const state = app.getState<ProofFlowState>()
    expect(Object.keys(state.data.goals)).toEqual(['g1', 'g2'])
    expect(state.data.goals.g1?.status).toBe('open')
  })

  it('applyTactic success then commitTactic resolves target goal', async () => {
    let syncCount = 0
    const app = await createApp({
      'lean.syncGoals': async (params) => {
        syncCount += 1
        const into = (params as { into: string }).into
        return [{
          op: 'set',
          path: into,
          value: {
            g1: { id: 'g1', statement: '⊢ True', status: syncCount > 1 ? 'resolved' : 'open' }
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

    await app.act('syncGoals').done()
    await app.act('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }).done()
    await app.act('commitTactic').done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.goals.g1?.status).toBe('resolved')
    expect(state.data.tacticResult).toBeNull()
    expect(state.data.applyingTactic).toBeNull()
  })

  it('applyTactic failure keeps goal open and dismiss clears pending result', async () => {
    const app = await createApp({
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
            tactic: 'omega',
            succeeded: false,
            newGoalIds: []
          }
        }]
      }
    })

    await app.act('syncGoals').done()
    await app.act('applyTactic', { goalId: 'g1', tactic: 'omega' }).done()
    await app.act('dismissTactic').done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.goals.g1?.status).toBe('open')
    expect(state.data.tacticResult).toBeNull()
    expect(state.data.applyingTactic).toBeNull()
  })

  it('selectGoal updates activeGoalId', async () => {
    const app = await createApp({
      'lean.syncGoals': async () => [],
      'lean.applyTactic': async () => []
    })

    await app.act('selectGoal', { goalId: 'g1' }).done()
    expect(app.getState<ProofFlowState>().data.activeGoalId).toBe('g1')

    await app.act('selectGoal', { goalId: null }).done()
    expect(app.getState<ProofFlowState>().data.activeGoalId).toBeNull()
  })

  it('blocks re-apply while tacticResult is present (no-op)', async () => {
    const app = await createApp({
      'lean.syncGoals': async (params) => {
        const into = (params as { into: string }).into
        return [{ op: 'set', path: into, value: { g1: { id: 'g1', statement: '⊢ True', status: 'open' } } }]
      },
      'lean.applyTactic': async (params) => {
        const into = (params as { into: string }).into
        return [{
          op: 'set',
          path: into,
          value: {
            goalId: 'g1',
            tactic: 'simp',
            succeeded: false,
            newGoalIds: []
          }
        }]
      }
    })

    await app.act('syncGoals').done()
    await app.act('applyTactic', { goalId: 'g1', tactic: 'simp' }).done()

    await app.act('applyTactic', { goalId: 'g1', tactic: 'omega' }).done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.lastTactic).toBe('simp')
    expect(state.data.tacticResult?.tactic).toBe('simp')
  })
})
