import { describe, expect, it, vi } from 'vitest'
import type { ProofDAG } from '../packages/schema/src/index.js'
import { createDagExtractEffect } from '../packages/host/src/effects/dag-extract.js'
import { createEditorRevealEffect } from '../packages/host/src/effects/editor-reveal.js'
import {
  createEditorGetCursorEffect,
  resolveNodeIdAtCursor
} from '../packages/host/src/effects/cursor-get.js'
import { createAttemptRecordEffect } from '../packages/host/src/effects/attempt-record.js'
import { createAttemptSuggestEffect } from '../packages/host/src/effects/attempt-suggest.js'
import { createAttemptApplyEffect } from '../packages/host/src/effects/attempt-apply.js'

const fileUri = 'file:///proof.lean'

const makeDag = (): ProofDAG => ({
  fileUri,
  rootIds: ['root'],
  nodes: {
    root: {
      id: 'root',
      kind: 'theorem',
      label: 'root',
      leanRange: { startLine: 1, startCol: 0, endLine: 10, endCol: 80 },
      goal: null,
      status: { kind: 'resolved', errorMessage: null, errorCategory: null },
      children: ['child'],
      dependencies: []
    },
    child: {
      id: 'child',
      kind: 'lemma',
      label: 'child',
      leanRange: { startLine: 3, startCol: 2, endLine: 4, endCol: 30 },
      goal: null,
      status: { kind: 'resolved', errorMessage: null, errorCategory: null },
      children: [],
      dependencies: []
    }
  },
  extractedAt: 123,
  metrics: {
    totalNodes: 2,
    resolvedCount: 2,
    errorCount: 0,
    sorryCount: 0,
    inProgressCount: 0,
    maxDepth: 1
  }
})

describe('Host effects', () => {
  it('dag.extract merges files entry and preserves previous fields', async () => {
    const dag = makeDag()
    const effect = createDagExtractEffect({
      extractDag: async () => dag,
      now: () => 999
    })

    const patches = await effect(
      { fileUri },
      {
        snapshot: {
          data: {
            files: {
              [fileUri]: {
                fileUri,
                dag: null,
                lastSyncedAt: 1,
                keepMe: true
              }
            }
          }
        }
      }
    )

    expect(patches).toEqual([{
      op: 'merge',
      path: 'files',
      value: {
        [fileUri]: {
          fileUri,
          dag,
          lastSyncedAt: 999,
          keepMe: true
        }
      }
    }])
  })

  it('dag.extract returns null dag patch when extractor fails', async () => {
    const effect = createDagExtractEffect({
      extractDag: async () => {
        throw new Error('LSP unavailable')
      },
      now: () => 111
    })

    const patches = await effect({ fileUri }, { snapshot: { data: {} } })
    expect(patches).toEqual([{
      op: 'merge',
      path: 'files',
      value: {
        [fileUri]: {
          fileUri,
          dag: null,
          lastSyncedAt: 111
        }
      }
    }])
  })

  it('dag.extract builds and validates DAG from loadContext', async () => {
    const effect = createDagExtractEffect({
      loadContext: async () => ({
        fileUri,
        sourceText: 'theorem demo : True := by\\n  exact True.intro',
        diagnostics: [{
          message: 'type mismatch, term has type Nat but is expected to have type Bool',
          severity: 'error',
          range: { startLine: 1, startCol: 0, endLine: 1, endCol: 12 }
        }],
        goals: [
          {
            goal: '⊢ Nat = Bool',
            range: { startLine: 1, startCol: 0, endLine: 1, endCol: 12 },
            source: 'test'
          },
          {
            goal: '⊢ True',
            source: 'test'
          }
        ]
      }),
      now: () => 700
    })

    const patches = await effect({ fileUri }, { snapshot: { data: {} } })
    expect(patches).toHaveLength(1)

    const mergePatch = patches[0]
    if (!mergePatch || mergePatch.op !== 'merge') {
      throw new Error('Expected merge patch')
    }

    const fileState = mergePatch.value[fileUri] as {
      dag: ProofDAG | null
      lastSyncedAt: number | null
    }

    expect(fileState.lastSyncedAt).toBe(700)
    expect(fileState.dag?.rootIds).toEqual(['root'])
    expect(fileState.dag?.extractedAt).toBe(700)
    expect(fileState.dag?.nodes['diag:0']?.status.kind).toBe('error')
    expect(fileState.dag?.nodes['diag:0']?.status.errorCategory).toBe('TYPE_MISMATCH')
    expect(fileState.dag?.nodes['diag:0']?.goal).toBe('⊢ Nat = Bool')
    expect(fileState.dag?.nodes.root?.goal).toBe('⊢ True')
  })

  it('dag.extract maps unmatched goal hints to root node', async () => {
    const effect = createDagExtractEffect({
      loadContext: async () => ({
        fileUri,
        sourceText: 'theorem demo : True := by\\n  exact True.intro',
        diagnostics: [{
          message: 'unknown identifier x',
          severity: 'error',
          range: { startLine: 1, startCol: 0, endLine: 1, endCol: 8 }
        }],
        goals: [{
          goal: '⊢ fallback goal',
          range: { startLine: 100, startCol: 0, endLine: 100, endCol: 20 },
          source: 'test'
        }]
      }),
      now: () => 701
    })

    const patches = await effect({ fileUri }, { snapshot: { data: {} } })
    const mergePatch = patches[0]
    if (!mergePatch || mergePatch.op !== 'merge') {
      throw new Error('Expected merge patch')
    }

    const fileState = mergePatch.value[fileUri] as { dag: ProofDAG | null }
    expect(fileState.dag?.nodes.root?.goal).toBe('⊢ fallback goal')
  })

  it('dag.extract returns null dag when candidate validation fails', async () => {
    const effect = createDagExtractEffect({
      extractDag: async () => ({
        fileUri,
        rootIds: ['missing-root'],
        nodes: {},
        extractedAt: 1,
        metrics: null
      }),
      now: () => 333
    })

    const patches = await effect({ fileUri }, { snapshot: { data: {} } })
    expect(patches).toEqual([{
      op: 'merge',
      path: 'files',
      value: {
        [fileUri]: {
          fileUri,
          dag: null,
          lastSyncedAt: 333
        }
      }
    }])
  })

  it('dag.extract merges goal hints from loadGoals adapter', async () => {
    const effect = createDagExtractEffect({
      loadContext: async () => ({
        fileUri,
        sourceText: 'theorem demo : True := by\\n  exact True.intro',
        diagnostics: [{
          message: 'type mismatch',
          severity: 'error',
          range: { startLine: 1, startCol: 0, endLine: 1, endCol: 12 }
        }],
        goals: [{
          goal: '⊢ from context root',
          source: 'context'
        }]
      }),
      loadGoals: async () => ([
        {
          goal: '⊢ from adapter diagnostic',
          range: { startLine: 1, startCol: 0, endLine: 1, endCol: 12 },
          source: 'adapter'
        }
      ]),
      now: () => 702
    })

    const patches = await effect({ fileUri }, { snapshot: { data: {} } })
    const mergePatch = patches[0]
    if (!mergePatch || mergePatch.op !== 'merge') {
      throw new Error('Expected merge patch')
    }

    const dag = (mergePatch.value[fileUri] as { dag: ProofDAG | null }).dag
    expect(dag?.nodes['diag:0']?.goal).toBe('⊢ from adapter diagnostic')
    expect(dag?.nodes.root?.goal).toBe('⊢ from context root')
  })

  it('editor.reveal resolves node range from snapshot and calls adapter', async () => {
    const reveal = vi.fn(async () => {})
    const effect = createEditorRevealEffect({ reveal })
    const dag = makeDag()

    const patches = await effect(
      { fileUri, nodeId: 'child' },
      { snapshot: { data: { files: { [fileUri]: { dag } } } } }
    )

    expect(patches).toEqual([])
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(reveal).toHaveBeenCalledWith({
      fileUri,
      range: dag.nodes.child.leanRange
    })
  })

  it('editor.reveal no-ops when node range cannot be resolved', async () => {
    const reveal = vi.fn(async () => {})
    const effect = createEditorRevealEffect({ reveal })

    const patches = await effect(
      { fileUri, nodeId: 'missing' },
      { snapshot: { data: { files: { [fileUri]: { dag: makeDag() } } } } }
    )

    expect(patches).toEqual([])
    expect(reveal).not.toHaveBeenCalled()
  })

  it('editor.getCursor resolves closest matching node and patches ui.cursorNodeId', async () => {
    const dag = makeDag()
    const effect = createEditorGetCursorEffect({
      getCursor: async () => ({
        fileUri,
        position: { line: 3, column: 10 }
      })
    })

    const patches = await effect({}, {
      snapshot: {
        data: {
          files: { [fileUri]: { dag } }
        }
      }
    })

    expect(patches).toEqual([{
      op: 'set',
      path: 'ui.cursorNodeId',
      value: 'child'
    }])
  })

  it('editor.getCursor falls back to null on adapter failure', async () => {
    const effect = createEditorGetCursorEffect({
      getCursor: async () => {
        throw new Error('No active editor')
      }
    })

    const patches = await effect({}, {})
    expect(patches).toEqual([{
      op: 'set',
      path: 'ui.cursorNodeId',
      value: null
    }])
  })

  it('resolveNodeIdAtCursor returns null when no range contains cursor', () => {
    const dag = makeDag()
    const nodeId = resolveNodeIdAtCursor(dag, {
      fileUri,
      position: { line: 50, column: 1 }
    })
    expect(nodeId).toBeNull()
  })

  it('attempt.record creates history and patterns patches', async () => {
    const effect = createAttemptRecordEffect({
      now: () => 1700000000000
    })

    const patches = await effect({
      fileUri,
      nodeId: 'child',
      tactic: 'simp',
      tacticKey: 'simp',
      result: 'error',
      contextErrorCategory: 'TACTIC_FAILED',
      errorMessage: 'simp failed',
      durationMs: 24
    }, {
      snapshot: { data: {} }
    })

    const historyPatch = patches.find((patch) => patch.op === 'set' && patch.path === 'history')
    const patternsPatch = patches.find((patch) => patch.op === 'set' && patch.path === 'patterns')

    expect(historyPatch).toBeDefined()
    expect(patternsPatch).toBeDefined()

    const history = (historyPatch as { value: any }).value
    expect(history.version).toBe('0.2.0')
    expect(history.files[fileUri].totalAttempts).toBe(1)
    expect(history.files[fileUri].nodes.child.currentStreak).toBe(1)
    expect(history.files[fileUri].nodes.child.lastFailureAt).toBe(1700000000000)

    const patterns = (patternsPatch as { value: any }).value
    const patternKey = 'TACTIC_FAILED:simp'
    expect(patterns.version).toBe('0.3.0')
    expect(patterns.totalAttempts).toBe(1)
    expect(patterns.entries[patternKey].failureCount).toBe(1)
    expect(patterns.entries[patternKey].successCount).toBe(0)
    expect(patterns.entries[patternKey].score).toBe(0)
  })

  it('attempt.record filters low-quality tactic keys from patterns', async () => {
    const effect = createAttemptRecordEffect({
      now: () => 1700000000005
    })

    const patches = await effect({
      fileUri,
      nodeId: 'child',
      tactic: 'auto:lemma',
      tacticKey: 'auto:lemma',
      result: 'error',
      contextErrorCategory: 'TACTIC_FAILED',
      errorMessage: 'auto generated marker',
      durationMs: 5
    }, {
      snapshot: { data: {} }
    })

    const historyPatch = patches.find((patch) => patch.op === 'set' && patch.path === 'history')
    const patternsPatch = patches.find((patch) => patch.op === 'set' && patch.path === 'patterns')

    expect(historyPatch).toBeDefined()
    expect(patternsPatch).toBeUndefined()

    const history = (historyPatch as { value: any }).value
    expect(history.files[fileUri].nodes.child.totalAttempts).toBe(1)
  })

  it('attempt.record stores goal signature from active node goal', async () => {
    const effect = createAttemptRecordEffect({
      now: () => 1700000000007
    })

    const patches = await effect({
      fileUri,
      nodeId: 'child',
      tactic: 'simp',
      tacticKey: 'simp',
      result: 'error',
      contextErrorCategory: 'TACTIC_FAILED',
      errorMessage: 'simp failed',
      durationMs: 8
    }, {
      snapshot: {
        data: {
          files: {
            [fileUri]: {
              dag: {
                nodes: {
                  child: {
                    goal: '⊢ n + 0 = n'
                  }
                }
              }
            }
          }
        }
      }
    })

    const patternsPatch = patches.find((patch) => patch.op === 'set' && patch.path === 'patterns')
    const patterns = (patternsPatch as { value: any }).value
    expect(patterns.entries['TACTIC_FAILED:simp'].goalSignature).toBe('n + 0 = n')
  })

  it('attempt.record appends attempts and resets streak on success', async () => {
    const effect = createAttemptRecordEffect({
      now: () => 1700000000010
    })

    const existingSnapshot = {
      history: {
        version: '0.2.0',
        files: {
          [fileUri]: {
            fileUri,
            nodes: {
              child: {
                nodeId: 'child',
                attempts: {
                  '1700000000000:1': {
                    id: '1700000000000:1',
                    fileUri,
                    nodeId: 'child',
                    timestamp: 1700000000000,
                    tactic: 'simp',
                    tacticKey: 'simp',
                    result: 'error',
                    contextErrorCategory: 'TACTIC_FAILED',
                    errorMessage: 'simp failed',
                    durationMs: 10
                  }
                },
                currentStreak: 1,
                totalAttempts: 1,
                lastAttemptAt: 1700000000000,
                lastSuccessAt: null,
                lastFailureAt: 1700000000000
              }
            },
            totalAttempts: 1,
            updatedAt: 1700000000000
          }
        }
      },
      patterns: {
        version: '0.3.0',
        entries: {
          'TACTIC_FAILED:simp': {
            key: 'TACTIC_FAILED:simp',
            errorCategory: 'TACTIC_FAILED',
            tacticKey: 'simp',
            successCount: 0,
            failureCount: 1,
            score: 0,
            lastUpdated: 1700000000000,
            dagFingerprint: null,
            dagClusterId: null,
            goalSignature: null
          }
        },
        totalAttempts: 1,
        updatedAt: 1700000000000
      }
    }

    const patches = await effect({
      fileUri,
      nodeId: 'child',
      tactic: 'exact?',
      tacticKey: 'exact',
      result: 'success',
      contextErrorCategory: 'TACTIC_FAILED',
      errorMessage: null,
      durationMs: 12
    }, {
      snapshot: { data: existingSnapshot }
    })

    const historyPatch = patches.find((patch) => patch.op === 'set' && patch.path === 'history')
    const patternsPatch = patches.find((patch) => patch.op === 'set' && patch.path === 'patterns')

    const history = (historyPatch as { value: any }).value
    const nodeHistory = history.files[fileUri].nodes.child
    expect(nodeHistory.totalAttempts).toBe(2)
    expect(nodeHistory.currentStreak).toBe(0)
    expect(nodeHistory.lastAttemptAt).toBe(1700000000010)
    expect(nodeHistory.lastSuccessAt).toBe(1700000000010)
    expect(nodeHistory.lastFailureAt).toBe(1700000000000)

    const patternKey = 'TACTIC_FAILED:exact'
    const patterns = (patternsPatch as { value: any }).value
    expect(patterns.totalAttempts).toBe(2)
    expect(patterns.entries[patternKey].successCount).toBe(1)
    expect(patterns.entries[patternKey].failureCount).toBe(0)
    expect(patterns.entries[patternKey].score).toBe(1)
  })

  it('attempt.apply records success when tactic insertion succeeds', async () => {
    const effect = createAttemptApplyEffect({
      now: () => 1700000000020,
      apply: async () => ({
        applied: true,
        durationMs: 9
      })
    })

    const patches = await effect({
      fileUri,
      nodeId: 'child',
      tactic: 'simp',
      tacticKey: 'simp',
      contextErrorCategory: 'TACTIC_FAILED',
      errorMessage: null
    }, {
      snapshot: { data: {} }
    })

    const historyPatch = patches.find((patch) => patch.op === 'set' && patch.path === 'history')
    const patternsPatch = patches.find((patch) => patch.op === 'set' && patch.path === 'patterns')
    const attempts = (historyPatch as { value: any }).value.files[fileUri].nodes.child.attempts
    const firstAttempt = Object.values(attempts)[0] as {
      result: string
      durationMs: number | null
      contextErrorCategory: string | null
    }

    expect(firstAttempt.result).toBe('success')
    expect(firstAttempt.durationMs).toBe(9)
    expect(firstAttempt.contextErrorCategory).toBe('TACTIC_FAILED')

    const patterns = (patternsPatch as { value: any }).value
    expect(patterns.entries['TACTIC_FAILED:simp'].successCount).toBe(1)
    expect(patterns.entries['TACTIC_FAILED:simp'].failureCount).toBe(0)
  })

  it('attempt.apply records failure when apply runner throws', async () => {
    const effect = createAttemptApplyEffect({
      now: () => 1700000000030,
      apply: async () => {
        throw new Error('editor busy')
      }
    })

    const patches = await effect({
      fileUri,
      nodeId: 'child',
      tactic: 'exact',
      tacticKey: 'exact',
      contextErrorCategory: null,
      errorMessage: null
    }, {
      snapshot: { data: {} }
    })

    const historyPatch = patches.find((patch) => patch.op === 'set' && patch.path === 'history')
    const patternsPatch = patches.find((patch) => patch.op === 'set' && patch.path === 'patterns')
    const attempts = (historyPatch as { value: any }).value.files[fileUri].nodes.child.attempts
    const firstAttempt = Object.values(attempts)[0] as {
      result: string
      errorMessage: string | null
      contextErrorCategory: string | null
    }

    expect(firstAttempt.result).toBe('error')
    expect(firstAttempt.errorMessage).toBe('editor busy')
    expect(firstAttempt.contextErrorCategory).toBeNull()

    const patterns = (patternsPatch as { value: any }).value
    expect(patterns.entries['OTHER:exact'].successCount).toBe(0)
    expect(patterns.entries['OTHER:exact'].failureCount).toBe(1)
  })

  it('attempt.suggest ranks by category match, score, and sample size', async () => {
    const effect = createAttemptSuggestEffect({
      now: () => 1700000000100,
      minSampleSize: 3,
      limit: 3
    })

    const patches = await effect({
      fileUri,
      nodeId: 'child'
    }, {
      snapshot: {
        data: {
          files: {
            [fileUri]: {
              dag: {
                nodes: {
                  child: {
                    status: {
                      errorCategory: 'TACTIC_FAILED'
                    }
                  }
                }
              }
            }
          },
          history: {
            files: {
              [fileUri]: {
                nodes: {
                  child: {
                    attempts: {
                      h1: {
                        timestamp: 1,
                        tacticKey: 'omega',
                        result: 'error',
                        contextErrorCategory: 'TACTIC_FAILED'
                      },
                      h2: {
                        timestamp: 2,
                        tacticKey: 'omega',
                        result: 'error',
                        contextErrorCategory: 'TACTIC_FAILED'
                      },
                      h3: {
                        timestamp: 3,
                        tacticKey: 'omega',
                        result: 'error',
                        contextErrorCategory: 'TACTIC_FAILED'
                      }
                    }
                  }
                }
              }
            }
          },
          patterns: {
            entries: {
              'TACTIC_FAILED:exact': {
                errorCategory: 'TACTIC_FAILED',
                tacticKey: 'exact',
                successCount: 4,
                failureCount: 1,
                score: 0.8
              },
              'TACTIC_FAILED:simp': {
                errorCategory: 'TACTIC_FAILED',
                tacticKey: 'simp',
                successCount: 3,
                failureCount: 0,
                score: 1
              },
              'TACTIC_FAILED:linarith': {
                errorCategory: 'TACTIC_FAILED',
                tacticKey: 'linarith',
                successCount: 1,
                failureCount: 1,
                score: 0.5
              },
              'OTHER:aesop': {
                errorCategory: 'OTHER',
                tacticKey: 'aesop',
                successCount: 9,
                failureCount: 1,
                score: 0.9
              }
            }
          },
          suggestions: {
            version: '0.4.0',
            byNode: {},
            updatedAt: null
          }
        }
      }
    })

    expect(patches).toHaveLength(1)
    expect(patches[0]?.op).toBe('set')
    expect(patches[0]?.path).toBe('suggestions')

    const suggestions = (patches[0] as { value: any }).value
    const child = suggestions.byNode.child as Array<{ tacticKey: string; generatedAt: number }>
    expect(child.map((entry) => entry.tacticKey)).toEqual(['simp', 'exact', 'omega'])
    expect(child.every((entry) => entry.generatedAt === 1700000000100)).toBe(true)
    expect(suggestions.updatedAt).toBe(1700000000100)
  })

  it('attempt.suggest uses history fallback and filters insufficient samples', async () => {
    const effect = createAttemptSuggestEffect({
      now: () => 1700000000200,
      minSampleSize: 3,
      limit: 5
    })

    const patches = await effect({
      fileUri,
      nodeId: 'child'
    }, {
      snapshot: {
        data: {
          history: {
            files: {
              [fileUri]: {
                nodes: {
                  child: {
                    attempts: {
                      a1: {
                        timestamp: 10,
                        tacticKey: 'simp',
                        result: 'error',
                        contextErrorCategory: 'OTHER'
                      },
                      a2: {
                        timestamp: 11,
                        tacticKey: 'simp',
                        result: 'success',
                        contextErrorCategory: 'OTHER'
                      },
                      a3: {
                        timestamp: 20,
                        tacticKey: 'exact',
                        result: 'success',
                        contextErrorCategory: 'OTHER'
                      },
                      a4: {
                        timestamp: 21,
                        tacticKey: 'exact',
                        result: 'success',
                        contextErrorCategory: 'OTHER'
                      },
                      a5: {
                        timestamp: 22,
                        tacticKey: 'exact',
                        result: 'error',
                        contextErrorCategory: 'OTHER'
                      },
                      a6: {
                        timestamp: 23,
                        tacticKey: 'aesop',
                        result: 'error',
                        contextErrorCategory: 'OTHER'
                      },
                      a7: {
                        timestamp: 24,
                        tacticKey: 'aesop',
                        result: 'error',
                        contextErrorCategory: 'OTHER'
                      },
                      a8: {
                        timestamp: 25,
                        tacticKey: 'aesop',
                        result: 'error',
                        contextErrorCategory: 'OTHER'
                      }
                    }
                  }
                }
              }
            }
          },
          patterns: {
            entries: {}
          },
          suggestions: {
            version: '0.4.0',
            byNode: {},
            updatedAt: null
          }
        }
      }
    })

    const suggestions = (patches[0] as { value: any }).value
    const child = suggestions.byNode.child as Array<{ tacticKey: string; sampleSize: number }>
    expect(child.map((entry) => entry.tacticKey)).toEqual(['exact', 'aesop'])
    expect(child.every((entry) => entry.sampleSize >= 3)).toBe(true)
  })

  it('attempt.suggest boosts node-local signal when pattern scores are close', async () => {
    const effect = createAttemptSuggestEffect({
      now: () => 1000,
      minSampleSize: 3,
      limit: 2
    })

    const patches = await effect({
      fileUri,
      nodeId: 'child'
    }, {
      snapshot: {
        data: {
          files: {
            [fileUri]: {
              dag: {
                nodes: {
                  child: {
                    status: {
                      errorCategory: 'TACTIC_FAILED'
                    }
                  }
                }
              }
            }
          },
          history: {
            files: {
              [fileUri]: {
                nodes: {
                  child: {
                    attempts: {
                      a1: { timestamp: 950, tacticKey: 'simp', result: 'success', contextErrorCategory: 'TACTIC_FAILED' },
                      a2: { timestamp: 951, tacticKey: 'simp', result: 'success', contextErrorCategory: 'TACTIC_FAILED' },
                      a3: { timestamp: 952, tacticKey: 'simp', result: 'success', contextErrorCategory: 'TACTIC_FAILED' },
                      a4: { timestamp: 953, tacticKey: 'simp', result: 'success', contextErrorCategory: 'TACTIC_FAILED' },
                      b1: { timestamp: 954, tacticKey: 'exact', result: 'error', contextErrorCategory: 'TACTIC_FAILED' },
                      b2: { timestamp: 955, tacticKey: 'exact', result: 'error', contextErrorCategory: 'TACTIC_FAILED' },
                      b3: { timestamp: 956, tacticKey: 'exact', result: 'error', contextErrorCategory: 'TACTIC_FAILED' },
                      b4: { timestamp: 957, tacticKey: 'exact', result: 'error', contextErrorCategory: 'TACTIC_FAILED' }
                    }
                  }
                }
              }
            }
          },
          patterns: {
            entries: {
              'TACTIC_FAILED:simp': {
                errorCategory: 'TACTIC_FAILED',
                tacticKey: 'simp',
                successCount: 8,
                failureCount: 2,
                score: 0.8,
                lastUpdated: 900
              },
              'TACTIC_FAILED:exact': {
                errorCategory: 'TACTIC_FAILED',
                tacticKey: 'exact',
                successCount: 9,
                failureCount: 1,
                score: 0.9,
                lastUpdated: 900
              }
            }
          },
          suggestions: {
            version: '0.4.0',
            byNode: {},
            updatedAt: null
          }
        }
      }
    })

    const suggestions = (patches[0] as { value: any }).value
    const child = suggestions.byNode.child as Array<{ tacticKey: string }>
    expect(child.map((entry) => entry.tacticKey)).toEqual(['simp', 'exact'])
  })

  it('attempt.suggest boosts goal-signature matched tactic when score gap is small', async () => {
    const effect = createAttemptSuggestEffect({
      now: () => 1700000000300,
      minSampleSize: 3,
      limit: 2
    })

    const basePatterns = {
      entries: {
        'TACTIC_FAILED:exact': {
          errorCategory: 'TACTIC_FAILED',
          tacticKey: 'exact',
          successCount: 8,
          failureCount: 2,
          score: 0.8,
          lastUpdated: 1700000000200,
          goalSignature: 'a + 0 = a'
        },
        'TACTIC_FAILED:simp': {
          errorCategory: 'TACTIC_FAILED',
          tacticKey: 'simp',
          successCount: 7,
          failureCount: 3,
          score: 0.7,
          lastUpdated: 1700000000200,
          goalSignature: 'n + 0 = n'
        }
      }
    }

    const makeSnapshot = (goal: string | null) => ({
      files: {
        [fileUri]: {
          dag: {
            nodes: {
              child: {
                goal,
                status: {
                  errorCategory: 'TACTIC_FAILED'
                }
              }
            }
          }
        }
      },
      history: { files: {} },
      patterns: basePatterns,
      suggestions: {
        version: '0.4.0',
        byNode: {},
        updatedAt: null
      }
    })

    const g0Patches = await effect({
      fileUri,
      nodeId: 'child'
    }, {
      snapshot: {
        data: makeSnapshot(null)
      }
    })
    const g1Patches = await effect({
      fileUri,
      nodeId: 'child'
    }, {
      snapshot: {
        data: makeSnapshot('⊢ n + 0 = n')
      }
    })

    const g0Suggestions = (g0Patches[0] as { value: any }).value.byNode.child as Array<{ tacticKey: string }>
    const g1Suggestions = (g1Patches[0] as { value: any }).value.byNode.child as Array<{ tacticKey: string }>
    expect(g0Suggestions.map((entry) => entry.tacticKey)).toEqual(['exact', 'simp'])
    expect(g1Suggestions.map((entry) => entry.tacticKey)).toEqual(['simp', 'exact'])
  })

  it('attempt.suggest prefers fresher patterns when other factors tie', async () => {
    const now = 1000 * 60 * 60 * 24 * 7
    const effect = createAttemptSuggestEffect({
      now: () => now,
      minSampleSize: 3,
      limit: 2
    })

    const patches = await effect({
      fileUri,
      nodeId: 'child'
    }, {
      snapshot: {
        data: {
          files: {
            [fileUri]: {
              dag: {
                nodes: {
                  child: {
                    status: {
                      errorCategory: 'TACTIC_FAILED'
                    }
                  }
                }
              }
            }
          },
          history: {
            files: {}
          },
          patterns: {
            entries: {
              'TACTIC_FAILED:simp': {
                errorCategory: 'TACTIC_FAILED',
                tacticKey: 'simp',
                successCount: 4,
                failureCount: 1,
                score: 0.8,
                lastUpdated: now - 1000
              },
              'TACTIC_FAILED:exact': {
                errorCategory: 'TACTIC_FAILED',
                tacticKey: 'exact',
                successCount: 4,
                failureCount: 1,
                score: 0.8,
                lastUpdated: 0
              }
            }
          },
          suggestions: {
            version: '0.4.0',
            byNode: {},
            updatedAt: null
          }
        }
      }
    })

    const suggestions = (patches[0] as { value: any }).value
    const child = suggestions.byNode.child as Array<{ tacticKey: string }>
    expect(child.map((entry) => entry.tacticKey)).toEqual(['simp', 'exact'])
  })

  it('attempt.suggest prunes stale suggestions and caps tracked nodes', async () => {
    const now = 1_700_000_000_000
    const effect = createAttemptSuggestEffect({
      now: () => now,
      minSampleSize: 1,
      limit: 2,
      ttlMs: 500,
      maxTrackedNodes: 2
    })

    const patches = await effect({
      fileUri,
      nodeId: 'child'
    }, {
      snapshot: {
        data: {
          files: {
            [fileUri]: {
              dag: {
                nodes: {
                  child: {
                    status: {
                      errorCategory: 'TACTIC_FAILED'
                    }
                  }
                }
              }
            }
          },
          history: { files: {} },
          patterns: {
            entries: {
              'TACTIC_FAILED:simp': {
                errorCategory: 'TACTIC_FAILED',
                tacticKey: 'simp',
                successCount: 4,
                failureCount: 1,
                score: 0.8,
                lastUpdated: now
              }
            }
          },
          suggestions: {
            version: '0.4.0',
            byNode: {
              staleNode: [{
                nodeId: 'staleNode',
                tacticKey: 'old',
                score: 0.9,
                sampleSize: 5,
                successRate: 0.9,
                sourceCategory: 'OTHER',
                generatedAt: now - 10_000
              }],
              recentNode: [{
                nodeId: 'recentNode',
                tacticKey: 'recent',
                score: 0.7,
                sampleSize: 3,
                successRate: 0.7,
                sourceCategory: 'OTHER',
                generatedAt: now - 100
              }],
              anotherRecentNode: [{
                nodeId: 'anotherRecentNode',
                tacticKey: 'another',
                score: 0.6,
                sampleSize: 3,
                successRate: 0.6,
                sourceCategory: 'OTHER',
                generatedAt: now - 120
              }]
            },
            updatedAt: now - 100
          }
        }
      }
    })

    const suggestions = (patches[0] as { value: any }).value
    const byNode = suggestions.byNode as Record<string, Array<{ tacticKey: string }>>
    expect(Object.keys(byNode)).toEqual(['child', 'recentNode'])
    expect(byNode.child?.length).toBeLessThanOrEqual(2)
    expect(byNode.child?.[0]?.tacticKey).toBe('simp')
    expect(byNode.staleNode).toBeUndefined()
  })
})
