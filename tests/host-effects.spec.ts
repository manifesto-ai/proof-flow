import { describe, expect, it, vi } from 'vitest'
import { createLeanApplyTacticEffect } from '../packages/host/src/effects/lean-apply-tactic.js'
import { createLeanSyncGoalsEffect } from '../packages/host/src/effects/lean-sync-goals.js'
import { deriveLeanState } from '../packages/host/src/lean/derive.js'

describe('Host effects (lean.*)', () => {
  it('lean.syncGoals writes domain goals and $host.leanState', async () => {
    const effect = createLeanSyncGoalsEffect({
      loadContext: async () => ({
        fileUri: 'file:///proof.lean',
        sourceText: 'theorem t : True := by\n  sorry\n',
        diagnostics: []
      }),
      now: () => 123
    })

    const patches = await effect({ into: 'goals' }, {})

    expect(patches).toHaveLength(2)
    expect(patches[0]).toMatchObject({ op: 'set', path: 'goals' })
    expect(patches[1]).toMatchObject({ op: 'set', path: '$host.leanState' })

    const goals = (patches[0] as { value: Record<string, { status: string }> }).value
    expect(Object.keys(goals).length).toBeGreaterThan(0)
    expect(Object.values(goals)[0]?.status).toBe('open')
  })

  it('lean.applyTactic returns tactic result and host refresh patch', async () => {
    const applyTactic = vi.fn(async () => ({ succeeded: true, errorMessage: null }))

    const effect = createLeanApplyTacticEffect({
      loadContext: async () => ({
        fileUri: 'file:///proof.lean',
        sourceText: 'theorem t : True := by\n  exact True.intro\n',
        diagnostics: []
      }),
      applyTactic,
      now: () => 456
    })

    const patches = await effect(
      { goalId: 'g1', tactic: 'exact True.intro', into: 'tacticResult' },
      {
        snapshot: {
          data: {
            goals: {
              g1: { id: 'g1', statement: '⊢ True', status: 'open' }
            },
            $host: {
              leanState: {
                fileUri: 'file:///proof.lean',
                goalPositions: {
                  g1: {
                    startLine: 2,
                    startCol: 2,
                    endLine: 2,
                    endCol: 7
                  }
                }
              }
            }
          }
        }
      }
    )

    expect(applyTactic).toHaveBeenCalledTimes(1)
    const tacticResultPatch = patches.find((patch) => patch.path === 'tacticResult')
    expect(tacticResultPatch).toBeDefined()
    expect((tacticResultPatch as { value: { succeeded: boolean; errorMessage: string | null } }).value).toMatchObject({
      succeeded: false,
      errorMessage: 'tactic applied but proof goal unchanged'
    })
    expect(patches.some((patch) => patch.path === '$host.leanState')).toBe(true)
  })

  it('lean.applyTactic converts adapter failure into succeeded=false result and keeps error message', async () => {
    const effect = createLeanApplyTacticEffect({
      loadContext: async () => null,
      applyTactic: async () => ({
        succeeded: false,
        errorMessage: 'TARGET_NOT_FOUND'
      })
    })

    const patches = await effect(
      { goalId: 'g1', tactic: 'simp', into: 'tacticResult' },
      {
        snapshot: {
          data: {
            $host: {
              leanState: {
                fileUri: 'file:///proof.lean',
                goalPositions: {}
              }
            }
          }
        }
      }
    )

    expect(patches).toHaveLength(1)
    expect((patches[0] as { value: { succeeded: boolean; errorMessage: string | null } }).value).toMatchObject({
      succeeded: false,
      errorMessage: 'TARGET_NOT_FOUND'
    })
  })

  it('lean.syncGoals preserves goal ids for whitespace-only source changes', async () => {
    const sourceWithWhitespace = [
      'theorem t : True := by',
      '  -- comment',
      '  sorry   ',
      ''
    ].join('\n')
    const sourceNormalized = [
      'theorem t : True := by',
      '  sorry',
      ''
    ].join('\n')
    const effect = createLeanSyncGoalsEffect({
      loadContext: async () => ({
        fileUri: 'file:///proof.lean',
        sourceText: sourceWithWhitespace,
        diagnostics: []
      }),
      now: () => 1
    })

    const first = await effect({ into: 'goals' }, {})

    const second = await createLeanSyncGoalsEffect({
      loadContext: async () => ({
        fileUri: 'file:///proof.lean',
        sourceText: sourceNormalized,
        diagnostics: []
      }),
      now: () => 1
    })({ into: 'goals' }, {})

    const firstGoals = (first[0] as { value: Record<string, { id: string }> }).value
    const secondGoals = (second[0] as { value: Record<string, { id: string }> }).value

    expect(new Set(Object.keys(firstGoals))).toEqual(new Set(Object.keys(secondGoals)))
  })

  it('lean.syncGoals preserves goal ids for repeated sync with same source', async () => {
    const effect = createLeanSyncGoalsEffect({
      loadContext: async () => ({
        fileUri: 'file:///proof.lean',
        sourceText: 'theorem t : True := by\n  by_cases h : True\n  · exact h.elim\n  · cases h\n  · sorry',
        diagnostics: []
      }),
      now: (): number => 1
    })

    const first = await effect({ into: 'goals' }, {})
    const second = await effect({ into: 'goals' }, {})

    const firstGoals = (first[0] as { value: Record<string, { id: string }> }).value
    const secondGoals = (second[0] as { value: Record<string, { id: string }> }).value

    expect(new Set(Object.keys(firstGoals))).toEqual(new Set(Object.keys(secondGoals)))
  })

  it('lean.applyTactic downgrades success when goal does not progress', async () => {
    const sourceText = 'theorem t : True := by\n  sorry\n'
    const context = {
      fileUri: 'file:///proof.lean',
      sourceText,
      diagnostics: []
    }
    const sourceGoals = deriveLeanState(context, 1).goals
    const [targetGoalId] = Object.keys(sourceGoals)

    expect(targetGoalId).toBeTypeOf('string')

    const effect = createLeanApplyTacticEffect({
      loadContext: async () => context,
      applyTactic: vi.fn(async () => ({
        succeeded: true
      })),
      now: () => 123
    })

    const patches = await effect(
      { goalId: targetGoalId ?? 'goal:1', tactic: 'simp', into: 'tacticResult' },
      {
        snapshot: {
          data: {
            goals: {
              [targetGoalId ?? 'goal:1']: {
                id: targetGoalId ?? 'goal:1',
                statement: '⊢ True',
                status: 'open'
              }
            },
            $host: {
              leanState: {
                fileUri: 'file:///proof.lean',
                goalPositions: {
                  [targetGoalId ?? 'goal:1']: {
                    startLine: 2,
                    startCol: 2,
                    endLine: 2,
                    endCol: 7
                  }
                }
              }
            }
          }
        }
      }
    )

    expect((patches[0] as { value: { succeeded: boolean; errorMessage: string | null } }).value).toMatchObject({
      succeeded: false
    })
    const errorMessage = (patches[0] as { value: { errorMessage: string | null } }).value.errorMessage
    expect(typeof errorMessage).toBe('string')
  })

  it('lean.applyTactic returns host refresh patch even on tactic failure', async () => {
    const applyTactic = vi.fn(async () => ({ succeeded: false, errorMessage: 'TIMEOUT' }))
    const effect = createLeanApplyTacticEffect({
      loadContext: async () => ({
        fileUri: 'file:///proof.lean',
        sourceText: 'theorem t : True := by\n  sorry\n',
        diagnostics: []
      }),
      applyTactic,
      now: () => 456
    })

    const patches = await effect(
      { goalId: 'goal:1:abc', tactic: 'omega', into: 'tacticResult' },
      {
        snapshot: {
          data: {
            goals: {
              'goal:1:abc': { id: 'goal:1:abc', statement: '⊢ True', status: 'open' }
            },
            $host: {
              leanState: {
                fileUri: 'file:///proof.lean',
                goalPositions: {
                  'goal:1:abc': {
                    startLine: 2,
                    startCol: 2,
                    endLine: 2,
                    endCol: 7
                  }
                }
              }
            }
          }
        }
      }
    )

    expect(applyTactic).toHaveBeenCalledTimes(1)
    expect(patches.some((patch) => patch.path === 'tacticResult')).toBe(true)
    expect(patches.some((patch) => patch.path === '$host.leanState')).toBe(true)
    expect((patches[0] as { value: { succeeded: boolean } }).value.succeeded).toBe(false)
  })
})
