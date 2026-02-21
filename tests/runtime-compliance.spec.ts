import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { App } from '@manifesto-ai/sdk'
import { createProofFlowApp } from '../packages/app/src/config.js'
import type { ProofFlowState } from '../packages/schema/src/index.js'

const domainMelPromise = readFile(
  new URL('../packages/schema/domain.mel', import.meta.url),
  'utf8'
)

type ActionResult = {
  completed?: () => Promise<unknown>
  done?: () => Promise<unknown>
}

const completeAction = async (result: ActionResult): Promise<void> => {
  if (result?.completed) {
    await result.completed()
    return
  }

  if (result?.done) {
    await result.done()
  }
}

const apps: App[] = []

const createApp = async (): Promise<App> => {
  const schema = await domainMelPromise
  const app = createProofFlowApp({
    schema,
    effects: {
      'lean.syncGoals': async (params) => {
        const into = (params as { into: string }).into
        return [{
          op: 'set',
          path: into,
          value: {
            g1: { id: 'g1', statement: '⊢ True', status: 'open' }
          }
        }]
      },
      'lean.applyTactic': async (params) => {
        const into = (params as { into: string }).into
        return [{
          op: 'set',
          path: into,
          value: {
            goalId: 'g1',
            tactic: 'simp',
            succeeded: true,
            errorMessage: null,
            newGoalIds: []
          }
        }]
      }
    }
  })

  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('Runtime compliance', () => {
  it('exposes required App interface methods', async () => {
    const app = await createApp()
    await app.ready()

    expect(typeof app.ready).toBe('function')
    expect(typeof app.dispose).toBe('function')
    expect(typeof app.act).toBe('function')
    expect(typeof app.getState).toBe('function')
    expect(typeof app.subscribe).toBe('function')
    expect(typeof app.fork).toBe('function')
    expect(typeof app.currentBranch).toBe('function')
  })

  it('processes sync/tactic intents and advances world head', async () => {
    const app = await createApp()
    await app.ready()

    const headBefore = app.getCurrentHead?.()
    await completeAction(app.act('syncGoals') as ActionResult)
    await completeAction(app.act('applyTactic', { goalId: 'g1', tactic: 'simp' }) as ActionResult)
    const headAfter = app.getCurrentHead?.()

    expect(headBefore).toBeDefined()
    expect(headAfter).toBeDefined()
    expect(headAfter).not.toBe(headBefore)

    const state = app.getState<ProofFlowState>()
    expect(state.data.goals.g1?.status).toBe('open')
    expect(state.data.tacticResult?.succeeded).toBe(true)
  })
})
