import { describe, expect, it } from 'vitest'
import { computeSnapshotHash } from '@manifesto-ai/world'
import { createTestManifesto, type ProofFlowSnapshotData } from './helpers/proof-flow.js'

describe('Manifesto compliance guards', () => {
  it('injects platform namespaces into snapshot data', async () => {
    const manifesto = await createTestManifesto({
      'lean.syncGoals': async () => [],
      'lean.applyTactic': async () => []
    })

    const snapshot = manifesto.getSnapshot()
    expect(snapshot.data).toHaveProperty('$host')
    expect(snapshot.data).toHaveProperty('$mel')

    manifesto.dispose()
  })

  it('excludes platform namespaces from snapshot hash', async () => {
    const manifesto = await createTestManifesto({
      'lean.syncGoals': async () => [],
      'lean.applyTactic': async () => []
    })

    const snapshot = manifesto.getSnapshot()
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

    const hashA = await computeSnapshotHash(snapshot as ProofFlowSnapshotData as any)
    const hashB = await computeSnapshotHash(withExtraPlatformData as any)
    expect(hashA).toBe(hashB)

    manifesto.dispose()
  })
})
