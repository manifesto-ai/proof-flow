import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { App, Effects } from '@manifesto-ai/sdk'
import type { ProofFlowState } from '../packages/schema/src/index.js'
import { createProofFlowApp } from '../packages/app/src/config.js'

const domainMelPromise = readFile(
  new URL('../packages/schema/domain.mel', import.meta.url),
  'utf8'
)

type ActionResult = {
  completed?: () => Promise<unknown>
  done?: () => Promise<unknown>
}

const completeAction = async (result: ActionResult): Promise<void> => {
  if (result?.completed) {
    await result.completed()
    return
  }

  if (result?.done) {
    await result.done()
  }
}

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

    await completeAction(app.act('syncGoals') as ActionResult)

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
            newGoalIds: [],
            errorMessage: null
          }
        }]
      }
    })

    await completeAction(app.act('syncGoals') as ActionResult)
    await completeAction(app.act('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }) as ActionResult)
    await completeAction(app.act('commitTactic') as ActionResult)

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
            newGoalIds: [],
            errorMessage: null
          }
        }]
      }
    })

    await completeAction(app.act('syncGoals') as ActionResult)
    await completeAction(app.act('applyTactic', { goalId: 'g1', tactic: 'omega' }) as ActionResult)
    await completeAction(app.act('dismissTactic') as ActionResult)

    const state = app.getState<ProofFlowState>()
    expect(state.data.goals.g1?.status).toBe('open')
    expect(state.data.tacticResult).toBeNull()
    expect(state.data.applyingTactic).toBeNull()
  })

  it('open goal transition follows success/failure loop', async () => {
    let applyCalls = 0
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
        applyCalls += 1
        const into = (params as { into: string }).into
        const tactic = (params as { tactic?: string }).tactic
        return [{
          op: 'set',
          path: into,
          value: {
            goalId: 'g1',
            tactic: tactic ?? 'simp',
            succeeded: applyCalls === 1,
            newGoalIds: [],
            errorMessage: null
          }
        }]
      }
    })

    await completeAction(app.act('syncGoals') as ActionResult)
    await completeAction(app.act('applyTactic', { goalId: 'g1', tactic: 'simp' }) as ActionResult)

    const failed = app.getState<ProofFlowState>()
    expect(failed.data.tacticResult?.succeeded).toBe(true)

    await completeAction(app.act('commitTactic') as ActionResult)
    const afterCommit = app.getState<ProofFlowState>()
    expect(afterCommit.data.applyingTactic).toBeNull()

    const appFailed = await createApp({
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
            newGoalIds: [],
            errorMessage: null
          }
        }]
      }
    })

    await completeAction(appFailed.act('syncGoals') as ActionResult)
    await completeAction(appFailed.act('applyTactic', { goalId: 'g1', tactic: 'omega' }) as ActionResult)

    const failedState = appFailed.getState<ProofFlowState>()
    expect(failedState.data.tacticResult?.succeeded).toBe(false)
    await completeAction(appFailed.act('dismissTactic') as ActionResult)

    const afterDismiss = appFailed.getState<ProofFlowState>()
    expect(afterDismiss.data.applyingTactic).toBeNull()
    expect(afterDismiss.data.tacticResult).toBeNull()
    expect(afterDismiss.data.goals.g1?.status).toBe('open')
  })

  it('selectGoal updates activeGoalId', async () => {
    const app = await createApp({
      'lean.syncGoals': async () => [],
      'lean.applyTactic': async () => []
    })

    await completeAction(app.act('selectGoal', { goalId: 'g1' }) as ActionResult)
    expect(app.getState<ProofFlowState>().data.activeGoalId).toBe('g1')

    await completeAction(app.act('selectGoal', { goalId: null }) as ActionResult)
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
            newGoalIds: [],
            errorMessage: null
          }
        }]
      }
    })

    await completeAction(app.act('syncGoals') as ActionResult)
    await completeAction(app.act('applyTactic', { goalId: 'g1', tactic: 'simp' }) as ActionResult)

    await completeAction(app.act('applyTactic', { goalId: 'g1', tactic: 'omega' }) as ActionResult)

    const state = app.getState<ProofFlowState>()
    expect(state.data.lastTactic).toBe('simp')
    expect(state.data.tacticResult?.tactic).toBe('simp')
  })

  it('blocks concurrent apply while pending (no-op)', async () => {
    let resolveTrigger = () => {}
    const waitForRelease = new Promise<void>((resolve) => {
      resolveTrigger = resolve
    })
    const applyCalls: string[] = []

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
      'lean.applyTactic': vi.fn(async (params) => {
        const into = (params as { into: string }).into
        const tactic = (params as { tactic: string }).tactic
        applyCalls.push(tactic)
        await waitForRelease
        return [{
          op: 'set',
          path: into,
          value: {
            goalId: 'g1',
            tactic,
            succeeded: true,
            newGoalIds: [],
            errorMessage: null
          }
        }]
      })
    })

    await completeAction(app.act('syncGoals') as ActionResult)

    const first = app.act('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' })
    const second = app.act('applyTactic', { goalId: 'g1', tactic: 'simp' })
    await Promise.resolve().then(() => {})
    resolveTrigger()

    await completeAction(first as ActionResult)
    await completeAction(second as ActionResult)

    expect((app.getState<ProofFlowState>().data.tacticResult?.tactic ?? '')).toBe('exact True.intro')
    expect(applyCalls).toEqual(['exact True.intro'])
  })

  it('blocks apply when goal is not open', async () => {
    const app = await createApp({
      'lean.syncGoals': async (params) => {
        const into = (params as { into: string }).into
        return [{
          op: 'set',
          path: into,
          value: {
            g1: { id: 'g1', statement: '⊢ False', status: 'resolved' }
          }
        }]
      },
      'lean.applyTactic': async () => {
        throw new Error('should not be called')
      }
    })

    await completeAction(app.act('syncGoals') as ActionResult)
    await completeAction(app.act('applyTactic', { goalId: 'g1', tactic: 'simp' }) as ActionResult)

    const state = app.getState<ProofFlowState>()
    expect(state.data.lastTactic).toBeNull()
    expect(state.data.tacticResult).toBeNull()
    expect(state.data.applyingTactic).toBeNull()
  })
})
