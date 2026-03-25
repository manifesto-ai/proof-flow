import { afterEach, describe, expect, it } from 'vitest'
import type { ProofFlowState } from '../packages/schema/src/index.js'
import { createTestRuntime, proofFlowOps } from './helpers/proof-flow.js'

const runtimes: Array<{ dispose: () => void; getSnapshot: () => { data: ProofFlowState & Record<string, unknown> } }> = []

const createTransitioningEffects = (opts: { succeed: boolean }) => {
  let applied = false

  return {
    'lean.syncGoals': async () => [
      proofFlowOps.set('goals', {
        g1: {
          id: 'g1',
          statement: '⊢ True',
          status: applied ? 'resolved' : 'open'
        }
      })
    ],
    'lean.applyTactic': async () => {
      if (opts.succeed) {
        applied = true
      }

      return [
        proofFlowOps.set('tacticResult', {
          goalId: 'g1',
          tactic: 'exact True.intro',
          succeeded: opts.succeed,
          errorMessage: null,
          newGoalIds: []
        })
      ]
    }
  }
}

const normalizeReport = (report: Awaited<ReturnType<Awaited<ReturnType<typeof createTestRuntime>>['lineageDiffReport']>>) => ({
  branch: report.branch,
  summary: report.summary,
  worldIds: report.worldIds,
  diffs: report.diffs.map((entry) => ({
    fromWorldId: entry.fromWorldId,
    toWorldId: entry.toWorldId,
    counts: entry.counts,
    addedGoals: entry.addedGoals,
    removedGoals: entry.removedGoals,
    statusChanges: entry.statusChanges,
    fromTacticResult: entry.fromTacticResult,
    toTacticResult: entry.toTacticResult
  }))
})

afterEach(() => {
  while (runtimes.length > 0) {
    runtimes.pop()?.dispose()
  }
})

describe('ProofFlow lineage invariants', () => {
  it('creates immutable world chain as actions commit', async () => {
    const runtime = await createTestRuntime(createTransitioningEffects({ succeed: true }))
    runtimes.push(runtime as any)

    const before = await runtime.lineageDiffReport(16)
    await runtime.dispatch('syncGoals', undefined, 'system')
    const afterSync = await runtime.lineageDiffReport(16)
    await runtime.dispatch('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }, 'ui')
    const afterApply = await runtime.lineageDiffReport(16)
    await runtime.dispatch('commitTactic', undefined, 'ui')
    const afterCommit = await runtime.lineageDiffReport(16)

    expect(new Set([
      before.branch.headWorldId,
      afterSync.branch.headWorldId,
      afterApply.branch.headWorldId,
      afterCommit.branch.headWorldId
    ]).size).toBe(4)
  })

  it('tracks goal status transitions in explicit world lineage', async () => {
    const runtime = await createTestRuntime(createTransitioningEffects({ succeed: true }))
    runtimes.push(runtime as any)

    await runtime.dispatch('syncGoals', undefined, 'system')
    await runtime.dispatch('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }, 'ui')
    await runtime.dispatch('commitTactic', undefined, 'ui')

    const report = await runtime.lineageDiffReport(16)
    expect(report.summary.statusChanged).toBeGreaterThanOrEqual(1)
    expect(report.diffs.some((entry) => entry.statusChanges.some((change) => change.toStatus === 'resolved'))).toBe(true)
  })

  it('records failed attempt without status mutation', async () => {
    const runtime = await createTestRuntime(createTransitioningEffects({ succeed: false }))
    runtimes.push(runtime as any)

    await runtime.dispatch('syncGoals', undefined, 'system')
    await runtime.dispatch('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }, 'ui')
    expect(runtime.getSnapshot().data.tacticResult?.succeeded).toBe(false)
    await runtime.dispatch('dismissTactic', undefined, 'ui')

    const report = await runtime.lineageDiffReport(16)
    expect(report.summary.statusChanged).toBe(0)
    expect(runtime.getSnapshot().data.goals.g1?.status).toBe('open')
  })

  it('replays same action log into identical domain state', async () => {
    const appA = await createTestRuntime(createTransitioningEffects({ succeed: true }))
    const appB = await createTestRuntime(createTransitioningEffects({ succeed: true }))
    runtimes.push(appA as any, appB as any)

    for (const runtime of [appA, appB]) {
      await runtime.dispatch('syncGoals', undefined, 'system')
      await runtime.dispatch('selectGoal', { goalId: 'g1' }, 'ui')
      await runtime.dispatch('applyTactic', { goalId: 'g1', tactic: 'exact True.intro' }, 'ui')
      await runtime.dispatch('commitTactic', undefined, 'ui')
    }

    expect(appA.getSnapshot().data).toEqual(appB.getSnapshot().data)

    const reportA = await appA.lineageDiffReport(16)
    const reportB = await appB.lineageDiffReport(16)
    expect(normalizeReport(reportA)).toEqual(normalizeReport(reportB))
  })
})
