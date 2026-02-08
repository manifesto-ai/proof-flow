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

  it('applies delta paths containing dotted file URIs without key corruption', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'proof-flow-worldstore-'))
    tempDirs.push(rootPath)

    const storeA = await createProofFlowWorldStore({ rootPath })

    const fileUri = 'file:///tmp/proof.lean'
    const genesisId = 'w_genesis_uri' as any
    const nextId = 'w_next_uri' as any

    await storeA.initializeGenesis?.({
      worldId: genesisId,
      schemaHash: 'schema-hash',
      snapshotHash: 'snapshot-hash-1',
      createdAt: 123,
      createdBy: null
    } as any, {
      data: {
        files: {
          [fileUri]: {
            fileUri,
            dag: null,
            lastSyncedAt: 1
          }
        },
        ui: {
          panelVisible: true
        }
      },
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
      worldId: nextId,
      schemaHash: 'schema-hash',
      snapshotHash: 'snapshot-hash-2',
      createdAt: 124,
      createdBy: 'p_1' as any
    } as any, {
      fromWorld: genesisId,
      toWorld: nextId,
      patches: [
        {
          op: 'set',
          path: `data.files.${fileUri}.lastSyncedAt`,
          value: 2
        }
      ],
      createdAt: 124
    } as any)

    await delay(25)

    const restored = await storeA.restore(nextId)
    const files = (restored.data as any).files

    expect(files[fileUri]).toBeDefined()
    expect(files[fileUri].lastSyncedAt).toBe(2)
    expect(Object.keys(files)).toEqual([fileUri])
  })

  it('applies history/pattern patches with dynamic keys containing dots', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'proof-flow-worldstore-'))
    tempDirs.push(rootPath)

    const storeA = await createProofFlowWorldStore({ rootPath })

    const fileUri = 'file:///tmp/proof.v1.lean'
    const nodeId = 'node.with.dot'
    const attemptId = 'attempt.1'
    const patternKey = 'OTHER:auto.simp.v2'
    const genesisId = 'w_genesis_dynamic' as any
    const nextId = 'w_next_dynamic' as any

    await storeA.initializeGenesis?.({
      worldId: genesisId,
      schemaHash: 'schema-hash',
      snapshotHash: 'snapshot-hash-1',
      createdAt: 1,
      createdBy: null
    } as any, {
      data: {
        history: {
          version: '0.2.0',
          files: {
            [fileUri]: {
              fileUri,
              nodes: {
                [nodeId]: {
                  nodeId,
                  attempts: {
                    [attemptId]: {
                      id: attemptId,
                      fileUri,
                      nodeId,
                      timestamp: 1,
                      tactic: 'simp',
                      tacticKey: 'simp',
                      result: 'error',
                      contextErrorCategory: 'OTHER',
                      errorMessage: 'x',
                      durationMs: 3
                    }
                  },
                  currentStreak: 1,
                  totalAttempts: 1,
                  lastAttemptAt: 1,
                  lastSuccessAt: null,
                  lastFailureAt: 1
                }
              },
              totalAttempts: 1,
              updatedAt: 1
            }
          }
        },
        patterns: {
          version: '0.3.0',
          entries: {
            [patternKey]: {
              key: patternKey,
              errorCategory: 'OTHER',
              tacticKey: 'simp',
              successCount: 0,
              failureCount: 1,
              score: 0,
              lastUpdated: 1,
              dagFingerprint: null,
              dagClusterId: null,
              goalSignature: null
            }
          },
          totalAttempts: 1,
          updatedAt: 1
        }
      },
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
        schemaHash: 'schema-hash'
      }
    } as any)

    await storeA.store({
      worldId: nextId,
      schemaHash: 'schema-hash',
      snapshotHash: 'snapshot-hash-2',
      createdAt: 2,
      createdBy: 'p_1' as any
    } as any, {
      fromWorld: genesisId,
      toWorld: nextId,
      patches: [
        {
          op: 'set',
          path: `data.history.files.${fileUri}.nodes.${nodeId}.attempts.${attemptId}.result`,
          value: 'success'
        },
        {
          op: 'set',
          path: `data.patterns.entries.${patternKey}.score`,
          value: 0.75
        }
      ],
      createdAt: 2
    } as any)

    await delay(25)

    const restored = await storeA.restore(nextId)
    const history = (restored.data as any).history.files[fileUri]
    const patterns = (restored.data as any).patterns.entries

    expect(history.nodes[nodeId].attempts[attemptId].result).toBe('success')
    expect(patterns[patternKey].score).toBe(0.75)
    expect(Object.keys((restored.data as any).history.files)).toEqual([fileUri])
    expect(Object.keys(patterns)).toEqual([patternKey])
  })
})
