import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManifestoInstance } from '@manifesto-ai/sdk'
import type { ProofFlowState } from '../packages/schema/src/index.js'
import {
  createTestManifesto,
  dispatchAction,
  proofFlowOps,
  type ProofFlowSnapshotData
} from './helpers/proof-flow.js'

const manifestos: Array<ManifestoInstance<ProofFlowSnapshotData>> = []

const snapshotState = (manifesto: ManifestoInstance<ProofFlowSnapshotData>): ProofFlowState => (
  manifesto.getSnapshot().data
)

afterEach(() => {
  while (manifestos.length > 0) {
    manifestos.pop()?.dispose()
  }
})

describe('ProofFlow v2 domain actions', () => {
  it('syncGoals stores extracted goals', async () => {
    const manifesto = await createTestManifesto({
      'lean.syncGoals': async () => [
        proofFlowOps.set('goals', {
          g1: { id: 'g1', statement: '⊢ True', status: 'open' },
          g2: { id: 'g2', statement: '⊢ False', status: 'failed' }
        })
      ],
      'lean.applyTactic': async () => []
    })
    manifestos.push(manifesto)

    await dispatchAction(manifesto, 'syncGoals')

    const state = snapshotState(manifesto)
    expect(Object.keys(state.goals)).toEqual(['g1', 'g2'])
    expect(state.goals.g1?.status).toBe('open')
  })

  it('applyTactic success then commitTactic resolves target goal', async () => {
    let syncCount = 0
    const manifesto = await createTestManifesto({
      'lean.syncGoals': async () => {
        syncCount += 1
        return [
          proofFlowOps.set('goals', {
            g1: { id: 'g1', statement: '⊢ True', status: syncCount > 1 ? 'resolved' : 'open' }
          })
        ]
      },
      'lean.applyTactic': async () => [
        proofFlowOps.set('tacticResult', {
          goalId: 'g1',
          tactic: 'exact True.intro',
          succeeded: true,
          newGoalIds: [],
          errorMessage: null
        })
      ]
    })
    manifestos.push(manifesto)

    await dispatchAction(manifesto, 'syncGoals')
    await dispatchAction(manifesto, 'applyTactic', { goalId: 'g1', tactic: 'exact True.intro' })
    await dispatchAction(manifesto, 'commitTactic')

    const state = snapshotState(manifesto)
    expect(state.goals.g1?.status).toBe('resolved')
    expect(state.tacticResult).toBeNull()
    expect(state.applyingTactic).toBeNull()
  })

  it('applyTactic failure keeps goal open and dismiss clears pending result', async () => {
    const manifesto = await createTestManifesto({
      'lean.syncGoals': async () => [
        proofFlowOps.set('goals', {
          g1: { id: 'g1', statement: '⊢ True', status: 'open' }
        })
      ],
      'lean.applyTactic': async () => [
        proofFlowOps.set('tacticResult', {
          goalId: 'g1',
          tactic: 'omega',
          succeeded: false,
          newGoalIds: [],
          errorMessage: null
        })
      ]
    })
    manifestos.push(manifesto)

    await dispatchAction(manifesto, 'syncGoals')
    await dispatchAction(manifesto, 'applyTactic', { goalId: 'g1', tactic: 'omega' })
    await dispatchAction(manifesto, 'dismissTactic')

    const state = snapshotState(manifesto)
    expect(state.goals.g1?.status).toBe('open')
    expect(state.tacticResult).toBeNull()
    expect(state.applyingTactic).toBeNull()
  })

  it('open goal transition follows success and failure loops', async () => {
    const success = await createTestManifesto({
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
          newGoalIds: [],
          errorMessage: null
        })
      ]
    })
    manifestos.push(success)

    await dispatchAction(success, 'syncGoals')
    await dispatchAction(success, 'applyTactic', { goalId: 'g1', tactic: 'simp' })
    expect(snapshotState(success).tacticResult?.succeeded).toBe(true)
    await dispatchAction(success, 'commitTactic')
    expect(snapshotState(success).applyingTactic).toBeNull()

    const failed = await createTestManifesto({
      'lean.syncGoals': async () => [
        proofFlowOps.set('goals', {
          g1: { id: 'g1', statement: '⊢ True', status: 'open' }
        })
      ],
      'lean.applyTactic': async () => [
        proofFlowOps.set('tacticResult', {
          goalId: 'g1',
          tactic: 'omega',
          succeeded: false,
          newGoalIds: [],
          errorMessage: null
        })
      ]
    })
    manifestos.push(failed)

    await dispatchAction(failed, 'syncGoals')
    await dispatchAction(failed, 'applyTactic', { goalId: 'g1', tactic: 'omega' })
    expect(snapshotState(failed).tacticResult?.succeeded).toBe(false)
    await dispatchAction(failed, 'dismissTactic')
    expect(snapshotState(failed).tacticResult).toBeNull()
    expect(snapshotState(failed).goals.g1?.status).toBe('open')
  })

  it('selectGoal updates activeGoalId', async () => {
    const manifesto = await createTestManifesto({
      'lean.syncGoals': async () => [],
      'lean.applyTactic': async () => []
    })
    manifestos.push(manifesto)

    await dispatchAction(manifesto, 'selectGoal', { goalId: 'g1' })
    expect(snapshotState(manifesto).activeGoalId).toBe('g1')

    await dispatchAction(manifesto, 'selectGoal', { goalId: null })
    expect(snapshotState(manifesto).activeGoalId).toBeNull()
  })

  it('blocks re-apply while tacticResult is present', async () => {
    const manifesto = await createTestManifesto({
      'lean.syncGoals': async () => [
        proofFlowOps.set('goals', {
          g1: { id: 'g1', statement: '⊢ True', status: 'open' }
        })
      ],
      'lean.applyTactic': async () => [
        proofFlowOps.set('tacticResult', {
          goalId: 'g1',
          tactic: 'simp',
          succeeded: false,
          newGoalIds: [],
          errorMessage: null
        })
      ]
    })
    manifestos.push(manifesto)

    await dispatchAction(manifesto, 'syncGoals')
    await dispatchAction(manifesto, 'applyTactic', { goalId: 'g1', tactic: 'simp' })
    await dispatchAction(manifesto, 'applyTactic', { goalId: 'g1', tactic: 'omega' })

    const state = snapshotState(manifesto)
    expect(state.lastTactic).toBe('simp')
    expect(state.tacticResult?.tactic).toBe('simp')
  })

  it('blocks concurrent apply while pending', async () => {
    let release = () => {}
    const waitForRelease = new Promise<void>((resolve) => {
      release = resolve
    })
    const applyCalls: string[] = []

    const manifesto = await createTestManifesto({
      'lean.syncGoals': async () => [
        proofFlowOps.set('goals', {
          g1: { id: 'g1', statement: '⊢ True', status: 'open' }
        })
      ],
      'lean.applyTactic': vi.fn(async (params) => {
        const tactic = (params as { tactic: string }).tactic
        applyCalls.push(tactic)
        await waitForRelease
        return [
          proofFlowOps.set('tacticResult', {
            goalId: 'g1',
            tactic,
            succeeded: true,
            newGoalIds: [],
            errorMessage: null
          })
        ]
      })
    })
    manifestos.push(manifesto)

    await dispatchAction(manifesto, 'syncGoals')

    const first = dispatchAction(manifesto, 'applyTactic', { goalId: 'g1', tactic: 'exact True.intro' })
    const second = dispatchAction(manifesto, 'applyTactic', { goalId: 'g1', tactic: 'simp' })

    await Promise.resolve()
    release()

    await first
    await second

    expect(snapshotState(manifesto).tacticResult?.tactic).toBe('exact True.intro')
    expect(applyCalls).toEqual(['exact True.intro'])
  })

  it('blocks apply when goal is not open', async () => {
    const manifesto = await createTestManifesto({
      'lean.syncGoals': async () => [
        proofFlowOps.set('goals', {
          g1: { id: 'g1', statement: '⊢ False', status: 'resolved' }
        })
      ],
      'lean.applyTactic': async () => {
        throw new Error('should not be called')
      }
    })
    manifestos.push(manifesto)

    await dispatchAction(manifesto, 'syncGoals')
    await dispatchAction(manifesto, 'applyTactic', { goalId: 'g1', tactic: 'simp' })

    const state = snapshotState(manifesto)
    expect(state.lastTactic).toBeNull()
    expect(state.tacticResult).toBeNull()
    expect(state.applyingTactic).toBeNull()
  })
})
