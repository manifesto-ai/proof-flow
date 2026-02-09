import { describe, expect, it, vi } from 'vitest'
import { createLeanApplyTacticEffect } from '../packages/host/src/effects/lean-apply-tactic.js'
import { createLeanSyncGoalsEffect } from '../packages/host/src/effects/lean-sync-goals.js'

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

  it('lean.applyTactic returns succeeded result and host refresh patch', async () => {
    const applyTactic = vi.fn(async () => ({ succeeded: true }))

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
    expect(patches[0]).toMatchObject({ op: 'set', path: 'tacticResult' })
    expect((patches[0] as { value: { succeeded: boolean } }).value.succeeded).toBe(true)
    expect(patches.some((patch) => patch.path === '$host.leanState')).toBe(true)
  })

  it('lean.applyTactic converts adapter failure into succeeded=false result', async () => {
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
    expect((patches[0] as { value: { succeeded: boolean } }).value.succeeded).toBe(false)
  })
})
