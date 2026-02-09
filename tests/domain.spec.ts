import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp, type App, type Effects } from '@manifesto-ai/app'
import type {
  Diagnosis,
  ProofDAG,
  ProofFlowState
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
      leanRange: { startLine: 1, startCol: 0, endLine: 2, endCol: 10 },
      goalCurrent: null,
      goalSnapshots: [],
      estimatedDistance: 0,
      status: { kind: 'in_progress', errorMessage: null, errorCategory: null },
      children: ['todo'],
      dependencies: []
    },
    todo: {
      id: 'todo',
      kind: 'sorry',
      label: 'todo',
      leanRange: { startLine: 3, startCol: 2, endLine: 3, endCol: 12 },
      goalCurrent: '⊢ True',
      goalSnapshots: [],
      estimatedDistance: 1,
      status: { kind: 'sorry', errorMessage: null, errorCategory: 'OTHER' },
      children: [],
      dependencies: ['root']
    }
  },
  extractedAt: 123,
  progress: {
    totalGoals: 1,
    resolvedGoals: 0,
    blockedGoals: 0,
    sorryGoals: 1,
    estimatedRemaining: 1
  }
})

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('ProofFlow v2 domain actions', () => {
  it('dag_sync merges file state from host effect', async () => {
    const fileUri = 'file:///proof.lean'
    const dag = makeDag(fileUri)

    const app = await createApp({
      'proof_flow.dag.extract': async (params) => {
        const target = (params as { fileUri: string }).fileUri
        return [{
          op: 'merge',
          path: 'files',
          value: {
            [target]: {
              fileUri: target,
              dag,
              lastSyncedAt: 456
            }
          }
        }]
      }
    })

    await app.act('dag_sync', { fileUri }).done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.files[fileUri]?.dag).toEqual(dag)
  })

  it('file_activate updates root navigation fields', async () => {
    const app = await createApp({})
    const fileUri = 'file:///proof.lean'

    await app.act('file_activate', { fileUri }).done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.activeFileUri).toBe(fileUri)
    expect(state.data.selectedNodeId).toBeNull()
    expect(state.data.cursorNodeId).toBeNull()
  })

  it('node_select triggers reveal and diagnose effects', async () => {
    const fileUri = 'file:///proof.lean'
    const revealCalls: Array<{ fileUri: string; nodeId: string }> = []
    const diagnoseCalls: Array<{ fileUri: string; nodeId: string }> = []
    const diagnosis: Diagnosis = {
      nodeId: 'todo',
      errorCategory: 'UNSOLVED_GOALS',
      rawMessage: 'unsolved goals',
      expected: null,
      actual: null,
      mismatchPath: null,
      hint: 'split goals',
      suggestedTactic: 'cases'
    }

    const app = await createApp({
      'proof_flow.editor.reveal': async (params) => {
        revealCalls.push(params as { fileUri: string; nodeId: string })
        return []
      },
      'proof_flow.diagnose': async (params) => {
        diagnoseCalls.push(params as { fileUri: string; nodeId: string })
        return [{ op: 'set', path: 'activeDiagnosis', value: diagnosis }]
      }
    })

    await app.act('file_activate', { fileUri }).done()
    await app.act('node_select', { nodeId: 'todo' }).done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.selectedNodeId).toBe('todo')
    expect(revealCalls).toHaveLength(1)
    expect(diagnoseCalls).toHaveLength(1)
    expect(state.data.activeDiagnosis?.nodeId).toBe('todo')
  })

  it('panel_set and cursor_sync update root state directly', async () => {
    const app = await createApp({})

    await app.act('panel_set', { visible: false }).done()
    await app.act('cursor_sync', { resolvedNodeId: 'root' }).done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.panelVisible).toBe(false)
    expect(state.data.cursorNodeId).toBe('root')
  })

  it('refreshes sorry queue and breakage map via effects', async () => {
    const app = await createApp({
      'proof_flow.sorry.analyze': async () => [{
        op: 'set',
        path: 'sorryQueue',
        value: {
          items: [{
            nodeId: 'todo',
            label: 'todo',
            goalText: '⊢ True',
            dependentCount: 0,
            estimatedDifficulty: 0.2
          }],
          totalSorries: 1
        }
      }],
      'proof_flow.breakage.analyze': async () => [{
        op: 'set',
        path: 'breakageMap',
        value: {
          edges: [{
            changedNodeId: 'def:a',
            brokenNodeId: 'thm:b',
            errorCategory: 'TYPE_MISMATCH',
            errorMessage: 'type mismatch'
          }],
          lastAnalyzedAt: 10
        }
      }]
    })

    await app.act('file_activate', { fileUri: 'file:///proof.lean' }).done()
    await app.act('sorry_queue_refresh').done()
    await app.act('breakage_analyze').done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.sorryQueue?.totalSorries).toBe(1)
    expect(state.data.breakageMap?.edges).toHaveLength(1)
  })
})
