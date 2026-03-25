import { afterEach, describe, expect, it } from 'vitest'
import { createTestRuntime, proofFlowOps } from './helpers/proof-flow.js'

const runtimes: Array<{ dispose: () => void }> = []

afterEach(() => {
  while (runtimes.length > 0) {
    runtimes.pop()?.dispose()
  }
})

describe('ProofFlow runtime config', () => {
  it('initializes v2 root fields and runs syncGoals through runtime dispatch', async () => {
    const runtime = await createTestRuntime({
      'lean.syncGoals': async () => [
        proofFlowOps.set('goals', {
          g1: { id: 'g1', statement: '⊢ True', status: 'open' }
        })
      ],
      'lean.applyTactic': async () => []
    })
    runtimes.push(runtime)

    await runtime.dispatch('syncGoals', undefined, 'system')

    const state = runtime.getSnapshot()
    expect(state.data.goals.g1?.status).toBe('open')
    expect(state.data.activeGoalId).toBeNull()
    expect(state.data.lastTactic).toBeNull()
    expect(state.data.tacticResult).toBeNull()
  })
})
