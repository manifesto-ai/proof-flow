import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp, type App, type Effects } from '@manifesto-ai/app'
import type { ProofDAG, ProofFlowState } from '../packages/schema/src/index.js'

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
      goalCurrent: null,
      goalSnapshots: [],
      estimatedDistance: 0,
      status: { kind: 'resolved', errorMessage: null, errorCategory: null },
      children: [],
      dependencies: []
    }
  },
  extractedAt: 123,
  progress: {
    totalGoals: 0,
    resolvedGoals: 0,
    blockedGoals: 0,
    sorryGoals: 0,
    estimatedRemaining: 0
  }
})

const deterministicEffects = (fileUri: string): Effects => ({
  'proof_flow.dag.extract': async () => [{
    op: 'merge',
    path: 'files',
    value: {
      [fileUri]: {
        fileUri,
        dag: makeDag(fileUri),
        lastSyncedAt: 456
      }
    }
  }],
  'proof_flow.editor.reveal': async () => [],
  'proof_flow.diagnose': async () => []
})

const stripPlatformState = (data: ProofFlowState & Record<string, unknown>) => {
  const entries = Object.entries(data).filter(([key]) => !key.startsWith('$'))
  return Object.fromEntries(entries)
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('ProofFlow lineage invariants', () => {
  it('creates retrievable immutable heads as actions commit', async () => {
    const fileUri = 'file:///proof.lean'
    const app = await createApp(deterministicEffects(fileUri))

    if (!app.getCurrentHead || !app.getSnapshot || !app.getWorld) {
      throw new Error('App lineage APIs are unavailable')
    }

    const head0 = app.getCurrentHead()
    await app.act('file_activate', { fileUri }).done()
    const head1 = app.getCurrentHead()
    await app.act('dag_sync', { fileUri }).done()
    const head2 = app.getCurrentHead()
    await app.act('panel_set', { visible: false }).done()
    const head3 = app.getCurrentHead()

    expect(new Set([head0, head1, head2, head3]).size).toBe(4)

    const snapshot1 = await app.getSnapshot(head1)
    const snapshot2 = await app.getSnapshot(head2)
    const snapshot3 = await app.getSnapshot(head3)

    expect(snapshot1.data.activeFileUri).toBe(fileUri)
    expect(snapshot2.data.files[fileUri]?.dag).not.toBeNull()
    expect(snapshot3.data.panelVisible).toBe(false)
  })

  it('replays same action log into identical domain state', async () => {
    const fileUri = 'file:///proof.lean'
    const appA = await createApp(deterministicEffects(fileUri))
    const appB = await createApp(deterministicEffects(fileUri))

    for (const app of [appA, appB]) {
      await app.act('file_activate', { fileUri }).done()
      await app.act('dag_sync', { fileUri }).done()
      await app.act('node_select', { nodeId: 'root' }).done()
      await app.act('cursor_sync', { resolvedNodeId: 'root' }).done()
      await app.act('panel_set', { visible: false }).done()
    }

    const stateA = appA.getState<ProofFlowState & Record<string, unknown>>()
    const stateB = appB.getState<ProofFlowState & Record<string, unknown>>()
    expect(stripPlatformState(stateA.data)).toEqual(stripPlatformState(stateB.data))
    expect(stateA.computed).toEqual(stateB.computed)
  })
})
