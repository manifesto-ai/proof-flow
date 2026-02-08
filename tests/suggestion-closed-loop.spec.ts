import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { App } from '@manifesto-ai/app'
import {
  createProofFlowEffects,
  type AttemptApplyRunnerInput
} from '../packages/host/src/index.js'
import type { ProofDAG, ProofFlowState } from '@proof-flow/schema'
import { createProofFlowApp } from '../packages/app/src/config.js'

const domainMelPromise = readFile(
  new URL('../packages/schema/domain.mel', import.meta.url),
  'utf8'
)

const apps: App[] = []

const fileUri = 'file:///proof.lean'
const nodeId = 'root'

const makeDag = (): ProofDAG => ({
  fileUri,
  rootIds: ['root'],
  nodes: {
    root: {
      id: 'root',
      kind: 'theorem',
      label: 'root',
      leanRange: { startLine: 1, startCol: 0, endLine: 4, endCol: 20 },
      goal: '⊢ True',
      status: {
        kind: 'error',
        errorMessage: 'unsolved goals',
        errorCategory: 'UNSOLVED_GOALS'
      },
      children: [],
      dependencies: []
    }
  },
  extractedAt: 1,
  metrics: {
    totalNodes: 1,
    resolvedCount: 0,
    errorCount: 1,
    sorryCount: 0,
    inProgressCount: 0,
    maxDepth: 0
  }
})

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('Suggestion closed loop', () => {
  it('runs suggest -> apply -> record -> resuggest as one loop', async () => {
    const schema = await domainMelPromise
    const applyCalls: AttemptApplyRunnerInput[] = []
    let clock = 1_700_000_001_000

    const app = createProofFlowApp({
      schema,
      effects: createProofFlowEffects({
        dagExtract: {
          extractDag: async () => makeDag(),
          now: () => clock++
        },
        editorReveal: {
          reveal: async () => {}
        },
        editorGetCursor: {
          getCursor: async () => ({
            fileUri,
            position: { line: 1, column: 0 }
          })
        },
        attemptRecord: {
          now: () => clock++
        },
        attemptSuggest: {
          now: () => clock++,
          minSampleSize: 1,
          limit: 3
        },
        attemptApply: {
          now: () => clock++,
          apply: async (input) => {
            applyCalls.push(input)
            return {
              applied: true,
              result: 'success',
              durationMs: 5
            }
          }
        }
      })
    })
    apps.push(app)
    await app.ready()

    await app.act('file_activate', { fileUri }).done()
    await app.act('dag_sync', { fileUri }).done()
    await app.act('node_select', { nodeId }).done()

    for (let index = 0; index < 3; index += 1) {
      await app.act('attempt_record', {
        fileUri,
        nodeId,
        tactic: 'simp',
        tacticKey: 'simp',
        result: 'error',
        contextErrorCategory: 'UNSOLVED_GOALS',
        errorMessage: 'simp failed',
        durationMs: 10
      }).done()
    }

    await app.act('attempt_suggest', { fileUri, nodeId }).done()
    let state = app.getState<ProofFlowState>().data
    expect(state.suggestions.byNode[nodeId]?.[0]?.tacticKey).toBe('simp')
    expect(state.suggestions.byNode[nodeId]?.[0]?.sampleSize).toBe(3)

    await app.act('attempt_apply', {
      fileUri,
      nodeId,
      tactic: 'simp',
      tacticKey: 'simp',
      contextErrorCategory: 'UNSOLVED_GOALS',
      errorMessage: null
    }).done()

    state = app.getState<ProofFlowState>().data
    expect(applyCalls).toHaveLength(1)
    expect(applyCalls[0]).toMatchObject({
      fileUri,
      nodeId,
      tactic: 'simp',
      tacticKey: 'simp'
    })
    expect(state.history.files[fileUri]?.nodes[nodeId]?.totalAttempts).toBe(4)
    expect(state.patterns.entries['UNSOLVED_GOALS:simp']?.successCount).toBe(1)
    expect(state.patterns.entries['UNSOLVED_GOALS:simp']?.failureCount).toBe(3)

    await app.act('attempt_suggest', { fileUri, nodeId }).done()
    state = app.getState<ProofFlowState>().data
    expect(state.suggestions.byNode[nodeId]?.[0]?.tacticKey).toBe('simp')
    expect(state.suggestions.byNode[nodeId]?.[0]?.sampleSize).toBe(4)
  })
})
