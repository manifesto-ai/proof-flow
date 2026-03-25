import { afterEach, describe, expect, it } from 'vitest'
import { createManifesto, type ManifestoInstance } from '@manifesto-ai/sdk'
import { createTestRuntime, proofFlowOps, type ProofFlowSnapshotData } from './helpers/proof-flow.js'

const manifestos: Array<ManifestoInstance<ProofFlowSnapshotData>> = []
const runtimes: Array<{ dispose: () => void }> = []

afterEach(() => {
  while (manifestos.length > 0) {
    manifestos.pop()?.dispose()
  }

  while (runtimes.length > 0) {
    runtimes.pop()?.dispose()
  }
})

describe('Runtime compliance', () => {
  it('exposes latest SDK public surface only', async () => {
    const manifesto = createManifesto<ProofFlowSnapshotData>({
      schema: `
        domain ProofFlow {
          state {
            goals: Record<string, { id: string, statement: string, status: string }> = {}
          }
        }
      `,
      effects: {}
    })
    manifestos.push(manifesto)

    expect(typeof manifesto.dispatch).toBe('function')
    expect(typeof manifesto.subscribe).toBe('function')
    expect(typeof manifesto.on).toBe('function')
    expect(typeof manifesto.getSnapshot).toBe('function')
    expect(typeof manifesto.dispose).toBe('function')

    expect('ready' in manifesto).toBe(false)
    expect('act' in manifesto).toBe(false)
    expect('fork' in manifesto).toBe(false)
    expect('currentBranch' in manifesto).toBe(false)
    expect('getCurrentHead' in manifesto).toBe(false)
  })

  it('processes sync/tactic intents and advances explicit world lineage', async () => {
    const runtime = await createTestRuntime({
      'lean.syncGoals': async () => [
        proofFlowOps.set('goals', {
          g1: { id: 'g1', statement: '⊢ True', status: 'open' }
        })
      ],
      'lean.applyTactic': async () => [
        proofFlowOps.set('tacticResult', {
          goalId: 'g1',
          tactic: 'simp',
          succeeded: true,
          errorMessage: null,
          newGoalIds: []
        })
      ]
    })
    runtimes.push(runtime)

    const before = await runtime.lineageDiffReport(16)
    await runtime.dispatch('syncGoals', undefined, 'system')
    await runtime.dispatch('applyTactic', { goalId: 'g1', tactic: 'simp' }, 'ui')
    const after = await runtime.lineageDiffReport(16)

    expect(after.branch.lineageLength).toBeGreaterThan(before.branch.lineageLength)

    const snapshot = runtime.getSnapshot()
    expect(snapshot.data.goals.g1?.status).toBe('open')
    expect(snapshot.data.tacticResult?.succeeded).toBe(true)
  })
})
