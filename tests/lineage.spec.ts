import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
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
        errorMessage: null,
        newGoalIds: []
      }
    }]
  }
})

const createTransitioningEffects = (opts: { succeed: boolean }): Effects => {
  let applied = false
  return {
    'lean.syncGoals': async (params) => {
      const into = (params as { into: string }).into
      return [{
        op: 'set',
        path: into,
        value: {
          g1: {
            id: 'g1',
            statement: '⊢ True',
            status: applied ? 'resolved' : 'open'
          }
        }
      }]
    },
    'lean.applyTactic': async (params) => {
      const into = (params as { into: string }).into
      if (opts.succeed) {
        applied = true
      }

      return [{
        op: 'set',
        path: into,
        value: {
          goalId: 'g1',
          tactic: 'exact True.intro',
          succeeded: opts.succeed,
          errorMessage: null,
          newGoalIds: []
        }
      }]
    }
  }
}

const stripPlatformState = (data: ProofFlowState & Record<string, unknown>) => {
  const ephemeralKeys = new Set(['applyingTactic', 'resolvingGoal', 'syncingGoals'])
  const entries = Object.entries(data).filter(([key]) => !key.startsWith('$') && !ephemeralKeys.has(key))
  return Object.fromEntries(entries)
}

type GoalRecord = { id: string; status: string; statement: string }

const extractGoalMap = (state: ProofFlowState | null | undefined): Map<string, GoalRecord> => {
  const goals = state?.goals
  if (!goals) {
    return new Map()
  }

  return new Map(
    Object.values(goals).map((goal) => [
      goal.id,
      {
        id: goal.id,
        status: goal.status,
        statement: goal.statement
      }
    ])
  )
}

const diffStatusCount = (from: ProofFlowState, to: ProofFlowState): number => {
  const fromGoals = extractGoalMap(from)
  let changed = 0

  for (const [goalId, rightGoal] of extractGoalMap(to)) {
    const leftGoal = fromGoals.get(goalId)
    if (leftGoal && leftGoal.status !== rightGoal.status) {
      changed += 1
    }
  }

  return changed
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
    await completeAction(app.act('syncGoals') as ActionResult)
    const head1 = app.getCurrentHead()
    await completeAction(app.act('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }) as ActionResult)
    const head2 = app.getCurrentHead()
    await completeAction(app.act('commitTactic') as ActionResult)
    const head3 = app.getCurrentHead()

    expect(new Set([head0, head1, head2, head3]).size).toBe(4)

    const snapshot1 = await app.getSnapshot(head1)
    const snapshot2 = await app.getSnapshot(head2)
    const snapshot3 = await app.getSnapshot(head3)

    expect(snapshot1.data.goals.g1.status).toBe('open')
    expect(snapshot2.data.tacticResult.succeeded).toBe(true)
    expect(snapshot3.data.tacticResult).toBeNull()
  })

  it('tracks goal status transitions in world lineage', async () => {
    const app = await createApp(createTransitioningEffects({ succeed: true }))

    if (!app.getCurrentHead || !app.getSnapshot) {
      throw new Error('App lineage APIs are unavailable')
    }

    await completeAction(app.act('syncGoals') as ActionResult)
    const headOpen = app.getCurrentHead()
    expect(headOpen).toBeTypeOf('string')

    await completeAction(app.act('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }) as ActionResult)
    const headAttempt = app.getCurrentHead()
    expect(headAttempt).toBeTypeOf('string')

    await completeAction(app.act('commitTactic') as ActionResult)
    const headResolved = app.getCurrentHead()
    expect(headResolved).toBeTypeOf('string')

    const openSnapshot = await app.getSnapshot(headOpen!)
    const resolvedSnapshot = await app.getSnapshot(headResolved!)
    const attemptSnapshot = await app.getSnapshot(headAttempt!)

    expect(openSnapshot.data.tacticResult).toBeNull()
    expect(attemptSnapshot.data.tacticResult?.succeeded).toBe(true)
    expect(diffStatusCount(
      openSnapshot.data as ProofFlowState,
      resolvedSnapshot.data as ProofFlowState
    )).toBe(1)
  })

  it('records failed attempt without status mutation', async () => {
    const app = await createApp(createTransitioningEffects({ succeed: false }))

    if (!app.getCurrentHead || !app.getSnapshot) {
      throw new Error('App lineage APIs are unavailable')
    }

    await completeAction(app.act('syncGoals') as ActionResult)
    const headOpen = app.getCurrentHead()

    await completeAction(app.act('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }) as ActionResult)
    const beforeDismiss = app.getState<ProofFlowState>()
    if (beforeDismiss.tacticResult) {
      expect(beforeDismiss.tacticResult.succeeded).toBe(false)
    }
    else {
      expect(beforeDismiss.tacticResult).toBeUndefined()
    }

    await completeAction(app.act('dismissTactic') as ActionResult)
    const afterDismiss = app.getState<ProofFlowState>()
    expect(afterDismiss.tacticResult).toBeUndefined()
    expect(afterDismiss.data.goals.g1?.status).toBe('open')

    const openSnapshot = await app.getSnapshot(headOpen!)
    const dismissSnapshot = await app.getSnapshot(app.getCurrentHead() as string)

    expect(diffStatusCount(
      openSnapshot.data as ProofFlowState,
      dismissSnapshot.data as ProofFlowState
    )).toBe(0)
  })

  it('replays same action log into identical domain state', async () => {
    const appA = await createApp(deterministicEffects())
    const appB = await createApp(deterministicEffects())

    for (const app of [appA, appB]) {
      await completeAction(app.act('syncGoals') as ActionResult)
      await completeAction(app.act('selectGoal', { goalId: 'g1' }) as ActionResult)
      await completeAction(app.act('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }) as ActionResult)
      await completeAction(app.act('commitTactic') as ActionResult)
    }

    const stateA = appA.getState<ProofFlowState & Record<string, unknown>>()
    const stateB = appB.getState<ProofFlowState & Record<string, unknown>>()
    expect(stripPlatformState(stateA.data)).toEqual(stripPlatformState(stateB.data))
    expect(stateA.computed).toEqual(stateB.computed)
  })
})
