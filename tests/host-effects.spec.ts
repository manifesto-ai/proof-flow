import { describe, expect, it, vi } from 'vitest'
import type { ProofDAG } from '../packages/schema/src/index.js'
import { createDagExtractEffect } from '../packages/host/src/effects/dag-extract.js'
import { createEditorRevealEffect } from '../packages/host/src/effects/editor-reveal.js'
import {
  createEditorGetCursorEffect,
  resolveNodeIdAtCursor
} from '../packages/host/src/effects/cursor-get.js'
import { createDiagnoseEffect } from '../packages/host/src/effects/diagnose.js'
import { createSorryAnalyzeEffect } from '../packages/host/src/effects/sorry-analyze.js'
import { createBreakageAnalyzeEffect } from '../packages/host/src/effects/breakage-analyze.js'

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
      goalCurrent: null,
      goalSnapshots: [],
      estimatedDistance: 0,
      status: { kind: 'in_progress', errorMessage: null, errorCategory: null },
      children: ['child', 'todo'],
      dependencies: []
    },
    child: {
      id: 'child',
      kind: 'lemma',
      label: 'child',
      leanRange: { startLine: 3, startCol: 2, endLine: 4, endCol: 30 },
      goalCurrent: '⊢ Nat = Bool',
      goalSnapshots: [],
      estimatedDistance: 2,
      status: { kind: 'error', errorMessage: 'type mismatch', errorCategory: 'TYPE_MISMATCH' },
      children: [],
      dependencies: ['root']
    },
    todo: {
      id: 'todo',
      kind: 'sorry',
      label: 'todo',
      leanRange: { startLine: 6, startCol: 2, endLine: 6, endCol: 14 },
      goalCurrent: '⊢ True',
      goalSnapshots: [],
      estimatedDistance: 1,
      status: { kind: 'sorry', errorMessage: null, errorCategory: 'OTHER' },
      children: [],
      dependencies: ['child']
    }
  },
  extractedAt: 123,
  progress: {
    totalGoals: 2,
    resolvedGoals: 0,
    blockedGoals: 1,
    sorryGoals: 1,
    estimatedRemaining: 3
  }
})

describe('Host effects (v2 core)', () => {
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

  it('editor.getCursor patches root cursorNodeId', async () => {
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
      path: 'cursorNodeId',
      value: 'child'
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

  it('diagnose writes activeDiagnosis for error nodes', async () => {
    const effect = createDiagnoseEffect()
    const patches = await effect({
      fileUri,
      nodeId: 'child'
    }, {
      snapshot: {
        data: {
          files: {
            [fileUri]: { dag: makeDag() }
          }
        }
      }
    })

    expect(patches[0]?.op).toBe('set')
    expect((patches[0] as { path: string }).path).toBe('activeDiagnosis')
    expect((patches[0] as { value: any }).value.nodeId).toBe('child')
    expect((patches[0] as { value: any }).value.errorCategory).toBe('TYPE_MISMATCH')
  })

  it('sorry.analyze uses activeFileUri and builds priority queue', async () => {
    const effect = createSorryAnalyzeEffect()
    const patches = await effect({}, {
      snapshot: {
        data: {
          activeFileUri: fileUri,
          files: {
            [fileUri]: { dag: makeDag() }
          }
        }
      }
    })

    expect(patches).toHaveLength(1)
    const queue = (patches[0] as { value: any }).value
    expect(queue.totalSorries).toBe(1)
    expect(queue.items[0].nodeId).toBe('todo')
  })

  it('breakage.analyze emits dependency->broken edges for error nodes', async () => {
    const effect = createBreakageAnalyzeEffect({ now: () => 1234 })
    const patches = await effect({}, {
      snapshot: {
        data: {
          activeFileUri: fileUri,
          files: {
            [fileUri]: { dag: makeDag() }
          }
        }
      }
    })

    expect(patches).toHaveLength(1)
    const map = (patches[0] as { value: any }).value
    expect(map.lastAnalyzedAt).toBe(1234)
    expect(map.edges[0]).toMatchObject({
      changedNodeId: 'root',
      brokenNodeId: 'child',
      errorCategory: 'TYPE_MISMATCH'
    })
  })
})
