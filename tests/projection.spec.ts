import { describe, expect, it } from 'vitest'
import type { AppState } from '@manifesto-ai/app'
import type { ProofFlowState } from '../packages/schema/src/index.js'
import { selectProjectionState } from '../packages/app/src/projection-state.js'

const baseData = (): ProofFlowState => ({
  appVersion: '2.0.0',
  files: {},
  activeFileUri: 'file:///proof.lean',
  selectedNodeId: 'child',
  cursorNodeId: 'root',
  panelVisible: true,
  sorryQueue: null,
  breakageMap: null,
  activeDiagnosis: null
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
  it('projects active dag with progress, goal chain, and derived sorry queue', () => {
    const state = makeState({
      data: {
        ...baseData(),
        selectedNodeId: 'child',
        cursorNodeId: 'root'
      },
      computed: {
        'computed.activeDag': {
          fileUri: 'file:///proof.lean',
          rootIds: ['root'],
          extractedAt: 1,
          progress: {
            totalGoals: 2,
            resolvedGoals: 0,
            blockedGoals: 1,
            sorryGoals: 1,
            estimatedRemaining: 3
          },
          nodes: {
            root: {
              id: 'root',
              kind: 'theorem',
              label: 'root',
              leanRange: { startLine: 1, startCol: 0, endLine: 1, endCol: 10 },
              goalCurrent: null,
              goalSnapshots: [],
              estimatedDistance: 0,
              status: { kind: 'in_progress', errorMessage: null, errorCategory: null },
              children: ['child', 'todo'],
              dependencies: []
            },
            child: {
              id: 'child',
              kind: 'have',
              label: 'child',
              leanRange: { startLine: 4, startCol: 2, endLine: 4, endCol: 20 },
              goalCurrent: '⊢ Nat = Bool',
              goalSnapshots: [{
                before: '⊢ Nat = Bool',
                after: null,
                tactic: 'simp',
                appliedLemmas: ['Nat.add_assoc'],
                subgoalsCreated: 1
              }],
              estimatedDistance: 2,
              status: { kind: 'error', errorMessage: 'type mismatch', errorCategory: 'TYPE_MISMATCH' },
              children: [],
              dependencies: ['root']
            },
            todo: {
              id: 'todo',
              kind: 'sorry',
              label: 'todo',
              leanRange: { startLine: 6, startCol: 2, endLine: 6, endCol: 8 },
              goalCurrent: '⊢ True',
              goalSnapshots: [],
              estimatedDistance: 1,
              status: { kind: 'sorry', errorMessage: null, errorCategory: 'OTHER' },
              children: [],
              dependencies: ['root']
            }
          }
        }
      }
    })

    const projection = selectProjectionState(state)
    expect(projection.activeDag?.totalNodes).toBe(3)
    expect(projection.progress).toMatchObject({
      totalGoals: 2,
      blockedGoals: 1,
      sorryGoals: 1
    })
    expect(projection.nodes.map((node) => node.id)).toEqual(['root', 'child', 'todo'])
    expect(projection.selectedNode?.id).toBe('child')
    expect(projection.goalChain).toHaveLength(1)
    expect(projection.hasSorries).toBe(true)
    expect(projection.sorryQueue[0]?.nodeId).toBe('todo')
  })

  it('prefers explicit diagnosis and breakage map from state', () => {
    const projection = selectProjectionState(makeState({
      data: {
        ...baseData(),
        activeDiagnosis: {
          nodeId: 'child',
          errorCategory: 'TYPE_MISMATCH',
          rawMessage: 'type mismatch',
          expected: 'Nat',
          actual: 'Bool',
          mismatchPath: 'at argument 2',
          hint: 'Check local hypotheses',
          suggestedTactic: 'exact ih'
        },
        breakageMap: {
          edges: [{
            changedNodeId: 'helper',
            brokenNodeId: 'child',
            errorCategory: 'TYPE_MISMATCH',
            errorMessage: 'type mismatch'
          }],
          lastAnalyzedAt: 10
        }
      }
    }))

    expect(projection.hasError).toBe(true)
    expect(projection.activeDiagnosis?.nodeId).toBe('child')
    expect(projection.breakageMap?.edges).toHaveLength(1)
  })

  it('falls back to unresolved focus when selected node is absent', () => {
    const projection = selectProjectionState(makeState({
      data: {
        ...baseData(),
        selectedNodeId: null,
        cursorNodeId: null
      },
      computed: {
        'computed.activeDag': {
          fileUri: 'file:///proof.lean',
          rootIds: ['root'],
          extractedAt: 1,
          progress: null,
          nodes: {
            root: {
              id: 'root',
              kind: 'theorem',
              label: 'root',
              leanRange: { startLine: 1, startCol: 0, endLine: 1, endCol: 10 },
              goalCurrent: null,
              goalSnapshots: [],
              estimatedDistance: 0,
              status: { kind: 'in_progress', errorMessage: null, errorCategory: null },
              children: ['err'],
              dependencies: []
            },
            err: {
              id: 'err',
              kind: 'have',
              label: 'err',
              leanRange: { startLine: 2, startCol: 2, endLine: 2, endCol: 10 },
              goalCurrent: '⊢ False',
              goalSnapshots: [],
              estimatedDistance: 1,
              status: { kind: 'error', errorMessage: 'boom', errorCategory: 'OTHER' },
              children: [],
              dependencies: ['root']
            }
          }
        }
      }
    }))

    expect(projection.selectedNode?.id).toBe('err')
  })
})
