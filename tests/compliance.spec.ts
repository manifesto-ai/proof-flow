import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp, type App } from '@manifesto-ai/app'
import { computeSnapshotHash } from '@manifesto-ai/world'

const domainMelPromise = readFile(
  new URL('../packages/schema/domain.mel', import.meta.url),
  'utf8'
)

const apps: App[] = []

const createApp = async () => {
  const domainMel = await domainMelPromise
  const app = createTestApp(domainMel, {
    effects: {},
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

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()))
})

describe('Manifesto compliance guards', () => {
  it('injects platform namespaces into resolved schema and state', async () => {
    const app = await createApp()

    const schema = app.getDomainSchema() as {
      state?: { fields?: Record<string, unknown> }
    }
    const state = app.getState() as {
      data?: Record<string, unknown>
    }

    expect(schema.state?.fields).toHaveProperty('$host')
    expect(schema.state?.fields).toHaveProperty('$mel')
    expect(state.data).toHaveProperty('$host')
    expect(state.data).toHaveProperty('$mel')
  })

  it('excludes platform namespaces from snapshot hash', async () => {
    const app = await createApp()

    const snapshot = app.getState() as {
      data: Record<string, unknown>
      computed: Record<string, unknown>
      system: Record<string, unknown>
      meta: Record<string, unknown>
    }

    const withExtraPlatformData = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
    withExtraPlatformData.data.$host = {
      intentSlots: {
        intent_x: { type: 'syncGoals' }
      }
    }
    withExtraPlatformData.data.$mel = {
      guards: {
        intent: {
          guard_x: 'intent_x'
        }
      }
    }

    const hashA = await computeSnapshotHash(snapshot as any)
    const hashB = await computeSnapshotHash(withExtraPlatformData as any)
    expect(hashA).toBe(hashB)
  })
})
