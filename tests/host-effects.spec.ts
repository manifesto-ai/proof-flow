import { describe, expect, it, vi } from 'vitest'
import type { ProofDAG } from '../packages/schema/src/index.js'
import { createDagExtractEffect } from '../packages/host/src/effects/dag-extract.js'
import { createEditorRevealEffect } from '../packages/host/src/effects/editor-reveal.js'
import {
  createEditorGetCursorEffect,
  resolveNodeIdAtCursor
} from '../packages/host/src/effects/cursor-get.js'

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
        }]
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
})
