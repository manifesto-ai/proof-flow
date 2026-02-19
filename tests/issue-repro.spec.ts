import { afterEach, describe, expect, it } from 'vitest'
import {
  type ActionHandle,
  type ActionResult,
  type App,
  type Effects,
  createApp
} from '@manifesto-ai/sdk'

type AwaitableActionResult = {
  done?: () => Promise<ActionResult>
  result?: () => Promise<ActionResult>
  completed?: () => Promise<ActionResult>
}

const toResult = async (handle: AwaitableActionResult): Promise<ActionResult> => {
  if (typeof handle.result === 'function') {
    return handle.result()
  }

  if (typeof handle.completed === 'function') {
    return handle.completed()
  }

  if (typeof handle.done === 'function') {
    return handle.done()
  }

  throw new Error('Unsupported ActionHandle type')
}

const createMiniApp = async (schema: string, effects: Effects, initialData: Record<string, unknown>): Promise<App> => {
  const app = createApp({
    schema,
    effects,
    actorPolicy: {
      mode: 'require',
      defaultActor: {
        actorId: 'proof-flow:issue-repro',
        kind: 'human'
      }
    },
    initialData
  })

  await app.ready()
  return app
}

const apps: App[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('Manifesto core issue reproductions', () => {
  it('repro #134: available when should not self-invalidate when action mutates guard fields', async () => {
    const schema = `
      domain Repro134 {
        state {
          pending: string | null = null
          result: string | null = null
        }

        action run() available when and(isNull(result), isNull(pending)) {
          once(pending) {
            patch pending = $meta.intentId
            effect demo.exec({ into: result })
          }
        }
      }
    `

    const app = await createMiniApp(
      schema,
      {
        'demo.exec': async (params) => {
          const into = typeof (params as { into: string }).into === 'string'
            ? (params as { into: string }).into
            : 'result'
          return [{ op: 'set', path: into, value: 'ok' }]
        }
      },
      { pending: null, result: null }
    )

    apps.push(app)

    const result = await toResult(app.act('run') as ActionHandle)
    const state = app.getState<{ data: { pending: string | null; result: string | null } }>()

    expect(result.status).toBe('completed')
    expect(state.data.result).toBe('ok')
    expect(state.data.pending).toBeTypeOf('string')
    expect(state.data.pending).toMatch(/.+/)
  })

  it('repro #135: at(record,key).field should access object field correctly', async () => {
    const schema = `
      domain Repro135 {
        type Item = {
          id: string,
          status: string
        }

        state {
          items: Record<string, Item> = {}
          goalId: string = "proof"
        }

        action check() available when and(
          isNotNull(at(items, goalId)),
          eq(at(items, goalId).status, "open")
        ) {
          onceIntent {
          }
        }
      }
    `

    const app = await createMiniApp(
      schema,
      {},
      {
        items: {
          proof: {
            id: 'proof',
            status: 'open'
          }
        },
        goalId: 'proof'
      }
    )

    apps.push(app)

    const result = await toResult(app.act('check', { id: 'proof' }) as ActionHandle)
    expect(result.status).toBe('completed')
  })
})
