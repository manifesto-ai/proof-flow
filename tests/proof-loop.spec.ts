import { afterEach, describe, expect, it } from 'vitest'
import type { ProofLoopReport, ProofLoopStep, ProofLoopStepType } from './fixtures/proof-loop.types.js'
import { createTestRuntime, proofFlowOps } from './helpers/proof-flow.js'

const runtimes: Array<{ dispose: () => void }> = []

afterEach(() => {
  while (runtimes.length > 0) {
    runtimes.pop()?.dispose()
  }
})

const runProofLoop = async (
  runtime: Awaited<ReturnType<typeof createTestRuntime>>,
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
      await runtime.dispatch('applyTactic', input, 'ui')
    }

    if (phase === 'select') {
      input = { goalId: 'g1' }
      await runtime.dispatch('selectGoal', input, 'ui')
    }

    if (phase === 'commit') {
      await runtime.dispatch('commitTactic', undefined, 'ui')
    }

    if (phase === 'dismiss') {
      await runtime.dispatch('dismissTactic', undefined, 'ui')
    }

    if (phase === 'sync') {
      await runtime.dispatch('syncGoals', undefined, 'system')
    }

    const snapshot = runtime.getSnapshot()
    const goals = Object.values(snapshot.data.goals)

    executed.push({
      phase,
      input,
      expected: {
        openGoals: goals.filter((goal) => goal.status === 'open').length,
        failedGoals: goals.filter((goal) => goal.status === 'failed').length,
        tacticPending: snapshot.data.applyingTactic !== null && snapshot.data.tacticResult === null,
        succeeded: snapshot.data.tacticResult?.succeeded
      }
    })
  }

  const finalState = runtime.getSnapshot()
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

describe('Proof loop report', () => {
  it('captures success + dismiss flow with summary counts', async () => {
    let syncCount = 0
    const runtime = await createTestRuntime({
      'lean.syncGoals': async () => {
        syncCount += 1
        return [
          proofFlowOps.set('goals', {
            g1: {
              id: 'g1',
              statement: '⊢ True',
              status: syncCount > 1 ? 'resolved' : 'open'
            }
          })
        ]
      },
      'lean.applyTactic': async (params: unknown) => {
        const tactic = (params as { tactic?: string } | undefined)?.tactic
        return [
          proofFlowOps.set('tacticResult', {
            goalId: 'g1',
            tactic: tactic ?? 'simp',
            succeeded: tactic === 'exact True.intro',
            errorMessage: null,
            newGoalIds: []
          })
        ]
      }
    })
    runtimes.push(runtime)

    const report = await runProofLoop(runtime, [
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
      'lean.syncGoals': async () => [
        proofFlowOps.set('goals', {
          g1: { id: 'g1', statement: '⊢ True', status: 'open' }
        })
      ],
      'lean.applyTactic': async (params: unknown) => {
        const tactic = (params as { tactic?: string } | undefined)?.tactic
        return [
          proofFlowOps.set('tacticResult', {
            goalId: 'g1',
            tactic: tactic ?? 'simp',
            succeeded: tactic === 'exact True.intro',
            errorMessage: null,
            newGoalIds: []
          })
        ]
      }
    }

    const first = await createTestRuntime(effectSet)
    const second = await createTestRuntime(effectSet)
    runtimes.push(first, second)

    const firstReport = await runProofLoop(first, ['sync', 'select', 'apply', 'commit', 'dismiss'])
    const secondReport = await runProofLoop(second, ['sync', 'select', 'apply', 'commit', 'dismiss'])

    expect(firstReport.summary).toEqual(secondReport.summary)
    expect(firstReport.steps.map((entry) => entry.phase)).toEqual(secondReport.steps.map((entry) => entry.phase))
  })
})
