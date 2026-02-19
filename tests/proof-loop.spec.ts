import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { App, Effects } from '@manifesto-ai/sdk'
import type { ProofFlowState } from '../packages/schema/src/index.js'
import type { ProofLoopReport, ProofLoopStep, ProofLoopStepType } from './fixtures/proof-loop.types.js'
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

const createApp = async (effects: Effects): Promise<App> => {
  const schema = await domainMelPromise
  const app = createProofFlowApp({
    schema,
    effects
  })
  await app.ready()
  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

const runProofLoop = async (
  app: App,
  steps: ReadonlyArray<ProofLoopStepType>
): Promise<ProofLoopReport> => {
  const startedAt = Date.now()
  const executed: ProofLoopStep[] = []
  let applyCount = 0

  for (const phase of steps) {
    let input: { goalId?: string; tactic?: string } | undefined

    if (phase === 'apply') {
      applyCount += 1
      const tactic = applyCount === 1 ? 'exact True.intro' : 'simp'
      input = { goalId: 'g1', tactic }
      await completeAction(app.act('applyTactic', input) as ActionResult)
    }

    if (phase === 'select') {
      input = { goalId: 'g1' }
      await completeAction(app.act('selectGoal', input) as ActionResult)
    }

    if (phase === 'commit') {
      await completeAction(app.act('commitTactic') as ActionResult)
    }

    if (phase === 'dismiss') {
      await completeAction(app.act('dismissTactic') as ActionResult)
    }

    if (phase === 'sync') {
      await completeAction(app.act('syncGoals') as ActionResult)
    }

    const normalized = app.getState<ProofFlowState>()
    const goals = Object.values(normalized.data.goals)

    const expected = {
      openGoals: goals.filter((goal) => goal.status === 'open').length,
      failedGoals: goals.filter((goal) => goal.status === 'failed').length,
      tacticPending: normalized.data.applyingTactic !== null && normalized.data.tacticResult === null,
      succeeded: normalized.data.tacticResult?.succeeded
    }

    executed.push({
      phase,
      input,
      expected
    })
  }

  const finalState = app.getState<ProofFlowState>()
  const finalGoals = Object.values(finalState.data.goals)

  return {
    file: 'mock:ProofFlow.lean',
    elapsedMs: Date.now() - startedAt,
    steps: executed,
    summary: {
      opens: finalGoals.filter((goal) => goal.status === 'open').length,
      fails: finalGoals.filter((goal) => goal.status === 'failed').length,
      commits: executed.filter((entry) => entry.phase === 'commit').length,
      syncs: executed.filter((entry) => entry.phase === 'sync').length
    }
  }
}

describe('Proof loop loop report', () => {
  it('captures success + dismiss flow with summary counts', async () => {
    const app = await createApp({
      'lean.syncGoals': async (params) => {
        const into = (params as { into: string }).into
        return [{
          op: 'set',
          path: into,
          value: {
            g1: {
              id: 'g1',
              statement: '⊢ True',
              status: 'open'
            }
          }
        }]
      },
      'lean.applyTactic': async (params: unknown) => {
        const tactic = (params as { tactic?: string } | undefined)?.tactic
        return {
          op: 'set',
          path: 'tacticResult',
          value: {
            goalId: 'g1',
            tactic: tactic ?? 'simp',
            succeeded: tactic === 'exact True.intro',
            newGoalIds: []
          }
        }
      }
    } as Effects)

    const report = await runProofLoop(app, [
      'sync',
      'select',
      'apply',
      'commit',
      'apply',
      'dismiss'
    ])

    expect(report.steps).toHaveLength(6)
    expect(report.summary.commits).toBe(1)
    expect(report.summary.fails).toBe(0)
    expect(report.steps.at(3)?.phase).toBe('commit')
  })

  it('replays same loop sequence for deterministic reporting shape', async () => {
    const effectSet = {
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
      'lean.applyTactic': async (params: unknown) => {
        const tactic = (params as { tactic?: string } | undefined)?.tactic
        return {
          op: 'set',
          path: 'tacticResult',
          value: {
            goalId: 'g1',
            tactic: tactic ?? 'simp',
            succeeded: tactic === 'exact True.intro',
            newGoalIds: []
          }
        }
      }
    }

    const first = await createApp(effectSet)
    const second = await createApp(effectSet)

    const firstReport = await runProofLoop(first, ['sync', 'select', 'apply', 'commit', 'dismiss'])
    const secondReport = await runProofLoop(second, ['sync', 'select', 'apply', 'commit', 'dismiss'])

    expect(firstReport.summary).toEqual(secondReport.summary)
    expect(firstReport.steps.map((entry) => entry.phase)).toEqual(secondReport.steps.map((entry) => entry.phase))
  })
})
