import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInMemoryWorldStore, type AppConfig, type Snapshot, type World, type WorldDelta, type WorldId, type WorldStore } from '@manifesto-ai/app'

const DEFAULT_STORE_PATH = '.proof-flow/world-store.json'

type PersistedStorePayload = {
  genesis: { world: World; snapshot: Snapshot } | null
  entries: Array<{ world: World; delta: WorldDelta }>
}

export type ProofFlowWorldOptions = {
  rootPath: string
  storePath?: string
}

const resolveStorePath = (options: ProofFlowWorldOptions): string => (
  options.storePath ?? join(options.rootPath, DEFAULT_STORE_PATH)
)

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

const readPersistedPayload = async (path: string): Promise<PersistedStorePayload> => {
  const exists = await fileExists(path)
  if (!exists) {
    return { genesis: null, entries: [] }
  }

  try {
    const content = await readFile(path, 'utf8')
    const parsed = JSON.parse(content) as PersistedStorePayload
    return {
      genesis: parsed.genesis ?? null,
      entries: parsed.entries ?? []
    }
  }
  catch {
    return { genesis: null, entries: [] }
  }
}

const persistPayload = async (payload: PersistedStorePayload, path: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const body = JSON.stringify(payload, null, 2)
  const tempPath = `${path}.tmp`
  await writeFile(tempPath, body, 'utf8')
  await rename(tempPath, path)
}

class FileBackedWorldStore implements WorldStore {
  private readonly inner = createInMemoryWorldStore()
  private readonly payload: PersistedStorePayload
  private readonly storePath: string
  private writing: Promise<void> = Promise.resolve()

  private constructor(payload: PersistedStorePayload, storePath: string) {
    this.payload = payload
    this.storePath = storePath
  }

  static async create(storePath: string): Promise<FileBackedWorldStore> {
    const payload = await readPersistedPayload(storePath)
    const store = new FileBackedWorldStore(payload, storePath)
    await store.replay()
    return store
  }

  private async replay(): Promise<void> {
    if (this.payload.genesis) {
      await this.inner.initializeGenesis(this.payload.genesis.world, this.payload.genesis.snapshot)
    }

    for (const entry of this.payload.entries) {
      await this.inner.store(entry.world, entry.delta)
    }
  }

  private schedulePersist(): void {
    this.writing = this.writing
      .then(async () => {
        await persistPayload(this.payload, this.storePath)
      })
      .catch(() => {
        // Swallow persistence failures to keep world execution available.
      })
  }

  async initializeGenesis(world: World, snapshot: Snapshot): Promise<void> {
    await this.inner.initializeGenesis(world, snapshot)
    this.payload.genesis = { world, snapshot }
    this.schedulePersist()
  }

  async store(world: World, delta: WorldDelta): Promise<void> {
    await this.inner.store(world, delta)
    this.payload.entries.push({ world, delta })
    this.schedulePersist()
  }

  async restore(worldId: WorldId): Promise<Snapshot> {
    return this.inner.restore(worldId)
  }

  async getWorld(worldId: WorldId): Promise<World | null> {
    return this.inner.getWorld(worldId)
  }

  async has(worldId: WorldId): Promise<boolean> {
    return this.inner.has(worldId)
  }

  async getChildren(worldId: WorldId): Promise<readonly WorldId[]> {
    return this.inner.getChildren(worldId)
  }

  async getLineage(worldId: WorldId): Promise<readonly WorldId[]> {
    return this.inner.getLineage(worldId)
  }
}

export const createProofFlowWorldStore = async (
  options: ProofFlowWorldOptions
): Promise<WorldStore> => FileBackedWorldStore.create(resolveStorePath(options))

export const createProofFlowWorld = async (options: {
  world: ProofFlowWorldOptions
}): Promise<AppConfig['world']> => ({
  store: await createProofFlowWorldStore(options.world)
})
