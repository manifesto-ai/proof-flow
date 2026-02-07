import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProofFlowWorldStore } from '../packages/app/src/worldstore.js'

const tempDirs: string[] = []

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ProofFlow custom world store', () => {
  it('persists and restores memory world store state', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'proof-flow-worldstore-'))
    tempDirs.push(rootPath)

    const storeA = await createProofFlowWorldStore({ rootPath })

    const genesisId = 'w_genesis' as any
    const world2Id = 'w_next' as any

    await storeA.initializeGenesis?.({
      worldId: genesisId,
      schemaHash: 'schema-hash',
      snapshotHash: 'snapshot-hash-1',
      createdAt: 123,
      createdBy: null
    } as any, {
      data: { ui: { panelVisible: true } },
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
        timestamp: 123,
        randomSeed: 'seed',
        schemaHash: 'schema-hash'
      }
    } as any)

    await storeA.store({
      worldId: world2Id,
      schemaHash: 'schema-hash',
      snapshotHash: 'snapshot-hash-2',
      createdAt: 124,
      createdBy: 'p_1' as any
    } as any, {
      fromWorld: genesisId,
      toWorld: world2Id,
      patches: [],
      createdAt: 124
    })

    // Persistence is async and event-driven.
    await delay(25)

    const storeFile = join(rootPath, '.proof-flow', 'world-store.json')
    const content = await readFile(storeFile, 'utf8')
    const parsed = JSON.parse(content) as { genesis: unknown; entries?: unknown[] }

    expect(parsed.genesis).not.toBeNull()
    expect(parsed.entries?.length ?? 0).toBe(1)

    const storeB = await createProofFlowWorldStore({ rootPath })
    expect(await storeB.has(genesisId)).toBe(true)
    expect(await storeB.has(world2Id)).toBe(true)
    expect(await storeB.getLineage(world2Id)).toEqual([world2Id, genesisId])
  })
})
