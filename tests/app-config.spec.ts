import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { App } from '@manifesto-ai/app'
import type { ProofFlowState } from '@proof-flow/schema'
import { createProofFlowApp } from '../packages/app/src/config.js'

const domainMelPromise = readFile(
  new URL('../packages/schema/domain.mel', import.meta.url),
  'utf8'
)

const apps: App[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('ProofFlow app config', () => {
  it('keeps required root fields after file activation', async () => {
    const schema = await domainMelPromise

    const app = createProofFlowApp({
      schema,
      effects: {
        'proof_flow.dag.extract': async () => [],
        'proof_flow.editor.reveal': async () => [],
        'proof_flow.attempt.record': async () => [],
        'proof_flow.attempt.suggest': async () => []
      }
    })

    await app.ready()
    apps.push(app)

    await app.act('file_activate', { fileUri: 'file:///proof.lean' }).done()

    const state = app.getState<ProofFlowState>()
    expect(state.data.appVersion).toBe('0.1.0')
    expect(state.data.files).toEqual({})
    expect(state.data.history.version).toBe('0.2.0')
    expect(state.data.patterns.version).toBe('0.3.0')
    expect(state.data.suggestions.version).toBe('0.4.0')
    expect(state.data.ui.activeFileUri).toBe('file:///proof.lean')
  })
})
