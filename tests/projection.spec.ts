import { describe, expect, it } from 'vitest'
import type { AppState } from '@manifesto-ai/sdk'
import type { ProofFlowState } from '../packages/schema/src/index.js'
import { selectProjectionState } from '../packages/app/src/projection-state.js'

const baseData = (): ProofFlowState & Record<string, unknown> => ({
  goals: {
    g1: { id: 'g1', statement: '⊢ True', status: 'open' },
    g2: { id: 'g2', statement: '⊢ False', status: 'failed' }
  },
  activeGoalId: 'g1',
  lastTactic: null,
  tacticResult: null,
  applyingTactic: null,
  resolvingGoal: null,
  syncingGoals: null,
  $host: {
    leanState: {
      fileUri: 'file:///proof.lean',
      dag: {
        nodes: {
          root: {
            nodeId: 'root',
            label: 'file:///proof.lean',
            kind: 'definition',
            startLine: 1,
            endLine: 20,
            parentId: null,
            status: 'in_progress',
            errorMessage: null,
            errorCategory: null,
            goalId: null
          },
          n1: {
            nodeId: 'n1',
            label: 'theorem t : True := by',
            kind: 'theorem',
            startLine: 2,
            endLine: 4,
            parentId: 'root',
            status: 'sorry',
            errorMessage: null,
            errorCategory: null,
            goalId: 'g1'
          },
          n2: {
            nodeId: 'n2',
            label: 'diagnostic: type mismatch',
            kind: 'diagnostic',
            startLine: 7,
            endLine: 7,
            parentId: 'root',
            status: 'error',
            errorMessage: 'type mismatch',
            errorCategory: 'TYPE_MISMATCH',
            goalId: 'g2'
          }
        },
        edges: [
          { source: 'root', target: 'n1' },
          { source: 'root', target: 'n2' }
        ]
      },
      diagnostics: [],
      goalPositions: {},
      lastElaboratedAt: 1
    }
  }
})

const makeState = (overrides?: Partial<AppState<unknown>>): AppState<unknown> => ({
  data: baseData(),
  computed: {},
  system: {
    status: 'idle',
    lastError: null,
    errors: [],
    pendingRequirements: [],
    currentAction: null
  },
  meta: {
    version: 1,
    timestamp: 1,
    randomSeed: 'seed',
    schemaHash: 'schema'
  },
  ...(overrides ?? {})
})

describe('Projection selector', () => {
  it('projects domain goals and host dag nodes', () => {
    const projection = selectProjectionState(makeState(), true)

    expect(projection.ui.panelVisible).toBe(true)
    expect(projection.activeFileUri).toBe('file:///proof.lean')
    expect(projection.progress).toMatchObject({
      totalGoals: 2,
      openGoals: 1,
      failedGoals: 1
    })
    expect(projection.selectedGoal?.id).toBe('g1')
    expect(projection.nodes.map((node) => node.id)).toEqual(['n1', 'n2'])
  })

  it('reads computed pending flag and tactic result', () => {
    const projection = selectProjectionState(makeState({
      data: {
        ...baseData(),
        tacticResult: {
          goalId: 'g1',
          tactic: 'simp',
          succeeded: false,
          newGoalIds: [],
          errorMessage: 'dummy error'
        }
      },
      computed: {
        'computed.isTacticPending': true
      }
    }), false)

    expect(projection.ui.panelVisible).toBe(false)
    expect(projection.isTacticPending).toBe(true)
    expect(projection.tacticResult?.tactic).toBe('simp')
    expect(projection.tacticResult?.errorMessage).toBe('dummy error')
  })

  it('normalizes tacticResult without explicit errorMessage', () => {
    const projection = selectProjectionState(makeState({
      data: {
        ...baseData(),
        tacticResult: {
          goalId: 'g1',
          tactic: 'simp',
          succeeded: true,
          newGoalIds: []
        }
      }
    }), true)

    expect(projection.tacticResult?.errorMessage).toBeNull()
  })

  it('falls back safely when $host.leanState is missing', () => {
    const projection = selectProjectionState(makeState({
      data: {
        goals: {},
        activeGoalId: null,
        lastTactic: null,
        tacticResult: null,
        applyingTactic: null,
        resolvingGoal: null,
        syncingGoals: null
      }
    }), true)

    expect(projection.activeFileUri).toBeNull()
    expect(projection.nodes).toEqual([])
    expect(projection.progress.totalGoals).toBe(0)
  })
})
