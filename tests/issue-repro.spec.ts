import { afterEach, describe, expect, it } from 'vitest'
import {
  createManifesto,
  createIntent,
  defineOps,
  dispatchAsync,
  type ManifestoInstance
} from '@manifesto-ai/sdk'

type ReproSnapshot = {
  pending?: string | null
  result?: string | null
  items?: Record<string, { id: string; status: string }>
  goalId?: string
}

const manifestos: Array<ManifestoInstance<ReproSnapshot>> = []
const reproOps = defineOps<ReproSnapshot & Record<string, unknown>>()

afterEach(() => {
  while (manifestos.length > 0) {
    manifestos.pop()?.dispose()
  }
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

    const manifesto = createManifesto<ReproSnapshot>({
      schema,
      effects: {
        'demo.exec': async () => [
          reproOps.set('result', 'ok')
        ]
      }
    })
    manifestos.push(manifesto)

    const snapshot = await dispatchAsync(manifesto, createIntent('run', 'repro-134'))

    expect(snapshot.data.result).toBe('ok')
    expect(typeof snapshot.data.pending).toBe('string')
    expect(snapshot.data.pending).toMatch(/.+/)
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

    const manifesto = createManifesto<ReproSnapshot>({
      schema,
      effects: {},
      snapshot: {
        data: {
          items: {
            proof: {
              id: 'proof',
              status: 'open'
            }
          },
          goalId: 'proof'
        } as ReproSnapshot,
        computed: {},
        system: {
          status: 'idle',
          lastError: null,
          errors: [],
          pendingRequirements: [],
          currentAction: null
        },
        meta: {
          version: 1,
          timestamp: 1,
          randomSeed: 'seed',
          schemaHash: 'schema'
        }
      }
    })
    manifestos.push(manifesto)

    const snapshot = await dispatchAsync(manifesto, createIntent('check', 'repro-135'))
    expect(snapshot.meta.schemaHash).toBeTypeOf('string')
  })
})
