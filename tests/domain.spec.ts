import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp, type App, type Effects } from '@manifesto-ai/app'
import {
  type ProofDAG,
  type ProofFlowState
} from '../packages/schema/src/index.js'

const domainMelPromise = readFile(
  new URL('../packages/schema/domain.mel', import.meta.url),
  'utf8'
)

const apps: App[] = []

const createApp = async (effects: Effects) => {
  const domainMel = await domainMelPromise
  const app = createTestApp(domainMel, {
    effects,
    actorPolicy: {
      mode: 'require',
      defaultActor: {
        actorId: 'proof-flow:local-user',
        kind: 'human'
      }
    }
  })

  await app.ready()
  apps.push(app)
  return app
}

const makeDag = (fileUri: string): ProofDAG => ({
  fileUri,
  rootIds: ['root'],
  nodes: {
    root: {
      id: 'root',
      kind: 'theorem',
      label: 'root',
      leanRange: { startLine: 1, startCol: 0, endLine: 1, endCol: 10 },
      goal: null,
      status: { kind: 'resolved', errorMessage: null, errorCategory: null },
      children: [],
      dependencies: []
    }
  },
  extractedAt: 123,
  metrics: {
    totalNodes: 1,
    resolvedCount: 1,
    errorCount: 0,
    sorryCount: 0,
    inProgressCount: 0,
    maxDepth: 0
  }
})

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('ProofFlow domain actions', () => {
  it('dag.sync merges file state from host effect', async () => {
    const fileUri = 'file:///proof.lean'
    const dag = makeDag(fileUri)

    const app = await createApp({
      'proof_flow.dag.extract': async (params) => {
        const { fileUri: target } = params as { fileUri: string }
        return [
          {
            op: 'merge',
            path: 'files',
            value: {
              [target]: {
                fileUri: target,
                dag,
                lastSyncedAt: 456
              }
            }
          }
        ]
      }
    })

    await app.act('dag_sync', { fileUri }).done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.files[fileUri]?.dag).toEqual(dag)
    expect(state.computed['computed.activeDag']).toBeNull()
  })

  it('file.activate updates ui state', async () => {
    const fileUri = 'file:///proof.lean'

    const app = await createApp({})

    await app.act('file_activate', { fileUri }).done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.ui.activeFileUri).toBe(fileUri)
    expect(state.data.ui.selectedNodeId).toBeNull()
    expect(state.data.ui.cursorNodeId).toBeNull()
  })

  it('node.select sets selection and triggers editor reveal', async () => {
    const fileUri = 'file:///proof.lean'
    const dag = makeDag(fileUri)
    const revealCalls: Array<{ fileUri: string; nodeId: string }> = []

    const app = await createApp({
      'proof_flow.dag.extract': async (params) => {
        const { fileUri: target } = params as { fileUri: string }
        return [
          {
            op: 'merge',
            path: 'files',
            value: {
              [target]: {
                fileUri: target,
                dag,
                lastSyncedAt: 456
              }
            }
          }
        ]
      },
      'proof_flow.editor.reveal': async (params) => {
        revealCalls.push(params as { fileUri: string; nodeId: string })
        return []
      }
    })

    await app.act('dag_sync', { fileUri }).done()
    await app.act('file_activate', { fileUri }).done()
    await app.act('node_select', { nodeId: 'root' }).done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.ui.selectedNodeId).toBe('root')
    expect(revealCalls).toHaveLength(1)
    expect(revealCalls[0]?.fileUri).toBe(fileUri)
    expect(revealCalls[0]?.nodeId).toBe('root')
  })

  it('panel.toggle and layout.set update ui fields', async () => {
    const app = await createApp({})

    await app.act('panel_toggle').done()
    await app.act('layout_set', { layout: 'leftRight' }).done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.ui.panelVisible).toBe(false)
    expect(state.data.ui.layout).toBe('leftRight')
  })

  it('zoom.set clamps values and collapse.toggle flips boolean', async () => {
    const app = await createApp({})

    await app.act('zoom_set', { zoom: 10 }).done()
    await app.act('collapse_toggle').done()

    let state = app.getState<ProofFlowState>()
    expect(state.data.ui.zoom).toBe(5)
    expect(state.data.ui.collapseResolved).toBe(true)

    await app.act('zoom_set', { zoom: 0.01 }).done()

    state = app.getState<ProofFlowState>()
    expect(state.data.ui.zoom).toBe(0.1)
  })

  it('attempt.record applies host-provided history and patterns patch', async () => {
    const fileUri = 'file:///proof.lean'
    const app = await createApp({
      'proof_flow.attempt.record': async () => [
        {
          op: 'set',
          path: 'history',
          value: {
            version: '0.2.0',
            files: {
              [fileUri]: {
                fileUri,
                nodes: {},
                totalAttempts: 1,
                updatedAt: 1
              }
            }
          }
        },
        {
          op: 'set',
          path: 'patterns',
          value: {
            version: '0.3.0',
            entries: {},
            totalAttempts: 1,
            updatedAt: 1
          }
        }
      ]
    })

    await app.act('attempt_record', {
      fileUri,
      nodeId: 'root',
      tactic: 'simp',
      tacticKey: 'simp',
      result: 'error',
      contextErrorCategory: 'TACTIC_FAILED',
      errorMessage: 'simp failed',
      durationMs: 10
    }).done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.history.files[fileUri]?.totalAttempts).toBe(1)
    expect(state.data.patterns.totalAttempts).toBe(1)
  })

  it('history.clear and patterns.reset clear accumulated state', async () => {
    const fileUri = 'file:///proof.lean'
    const app = await createApp({
      'proof_flow.attempt.record': async () => [
        {
          op: 'set',
          path: 'history',
          value: {
            version: '0.2.0',
            files: {
              [fileUri]: {
                fileUri,
                nodes: {},
                totalAttempts: 2,
                updatedAt: 2
              }
            }
          }
        },
        {
          op: 'set',
          path: 'patterns',
          value: {
            version: '0.3.0',
            entries: {
              key: {
                key: 'OTHER:simp',
                errorCategory: 'OTHER',
                tacticKey: 'simp',
                successCount: 0,
                failureCount: 2,
                score: 0,
                lastUpdated: 2,
                dagFingerprint: null,
                dagClusterId: null,
                goalSignature: null
              }
            },
            totalAttempts: 2,
            updatedAt: 2
          }
        }
      ]
    })

    await app.act('attempt_record', {
      fileUri,
      nodeId: 'root',
      tactic: 'simp',
      tacticKey: 'simp',
      result: 'error',
      contextErrorCategory: 'OTHER',
      errorMessage: 'failed',
      durationMs: 20
    }).done()

    await app.act('history_clear').done()
    await app.act('patterns_reset').done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.history.files).toEqual({})
    expect(state.data.patterns.entries).toEqual({})
    expect(state.data.patterns.totalAttempts).toBe(0)
    expect(state.data.patterns.updatedAt).toBeNull()
  })
})
