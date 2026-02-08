import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type AppConfig,
  type Snapshot,
  type World,
  type WorldDelta,
  type WorldId,
  type WorldStore
} from '@manifesto-ai/app'

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

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
)

const stripPlatformNamespaces = (data: unknown): unknown => {
  if (!isRecord(data)) {
    return data
  }

  const cleanData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('$')) {
      cleanData[key] = value
    }
  }
  return cleanData
}

const sanitizeSnapshot = (snapshot: Snapshot): Snapshot => {
  const data = stripPlatformNamespaces(snapshot.data)
  if (data === snapshot.data) {
    return snapshot
  }

  return {
    ...snapshot,
    data
  }
}

const splitPatchPath = (path: string): { root: 'data' | 'system' | 'input' | 'computed' | 'meta'; subPath: string } => {
  if (path === 'data' || path.startsWith('data.')) {
    return { root: 'data', subPath: path === 'data' ? '' : path.slice(5) }
  }
  if (path === 'system' || path.startsWith('system.')) {
    return { root: 'system', subPath: path === 'system' ? '' : path.slice(7) }
  }
  if (path === 'input' || path.startsWith('input.')) {
    return { root: 'input', subPath: path === 'input' ? '' : path.slice(6) }
  }
  if (path === 'computed' || path.startsWith('computed.')) {
    return { root: 'computed', subPath: path === 'computed' ? '' : path.slice(9) }
  }
  if (path === 'meta' || path.startsWith('meta.')) {
    return { root: 'meta', subPath: path === 'meta' ? '' : path.slice(5) }
  }
  return { root: 'data', subPath: path }
}

const splitSegments = (path: string): string[] => (
  path.split('.').filter((segment) => segment.length > 0)
)

const findLongestMatchingKey = (
  object: Record<string, unknown>,
  rest: string
): string | null => {
  const candidates = Object.keys(object).sort((a, b) => b.length - a.length)
  const matched = candidates.find((candidate) => (
    rest === candidate || rest.startsWith(`${candidate}.`)
  ))
  return matched ?? null
}

const dynamicKeyDelimiters = (path: string[]): string[] | null => {
  if (path.length === 1 && path[0] === 'files') {
    return ['fileUri', 'dag', 'lastSyncedAt', 'nodes', 'totalAttempts', 'updatedAt']
  }

  if (path.length === 2 && path[0] === 'history' && path[1] === 'files') {
    return ['fileUri', 'nodes', 'totalAttempts', 'updatedAt']
  }

  if (
    path.length === 4
    && path[0] === 'history'
    && path[1] === 'files'
    && path[3] === 'nodes'
  ) {
    return [
      'nodeId',
      'attempts',
      'currentStreak',
      'totalAttempts',
      'lastAttemptAt',
      'lastSuccessAt',
      'lastFailureAt'
    ]
  }

  if (
    path.length === 6
    && path[0] === 'history'
    && path[1] === 'files'
    && path[3] === 'nodes'
    && path[5] === 'attempts'
  ) {
    return [
      'id',
      'fileUri',
      'nodeId',
      'timestamp',
      'tactic',
      'tacticKey',
      'result',
      'contextErrorCategory',
      'errorMessage',
      'durationMs'
    ]
  }

  if (path.length === 2 && path[0] === 'patterns' && path[1] === 'entries') {
    return [
      'key',
      'errorCategory',
      'tacticKey',
      'successCount',
      'failureCount',
      'score',
      'lastUpdated',
      'dagFingerprint',
      'dagClusterId',
      'goalSignature'
    ]
  }

  return null
}

const extractDynamicKeyFromRest = (
  rest: string,
  delimiters: string[]
): { key: string; nextRest: string } => {
  const candidateIndexes = delimiters
    .map((delimiter) => {
      const marker = `.${delimiter}`
      const index = rest.indexOf(marker)
      return index > 0 ? index : Number.POSITIVE_INFINITY
    })
    .filter((index) => Number.isFinite(index))

  const markerIndex = candidateIndexes.length > 0
    ? Math.min(...candidateIndexes)
    : -1

  if (markerIndex <= 0) {
    return { key: rest, nextRest: '' }
  }

  return {
    key: rest.slice(0, markerIndex),
    nextRest: rest.slice(markerIndex + 1)
  }
}

const splitHead = (rest: string): { head: string; tail: string } => {
  const firstDot = rest.indexOf('.')
  if (firstDot < 0) {
    return { head: rest, tail: '' }
  }

  return {
    head: rest.slice(0, firstDot),
    tail: rest.slice(firstDot + 1)
  }
}

const resolveDataPath = (
  snapshot: Snapshot,
  rawSubPath: string
): string[] => {
  if (!rawSubPath) {
    return ['data']
  }

  const segments: string[] = ['data']
  const data = isRecord(snapshot.data) ? snapshot.data : {}
  let current: Record<string, unknown> | null = data
  let rest = rawSubPath
  let logicalPath: string[] = []

  while (rest.length > 0) {
    let nextKey: string
    let nextRest = ''

    const existing = current ? findLongestMatchingKey(current, rest) : null
    if (existing) {
      nextKey = existing
      nextRest = rest === existing ? '' : rest.slice(existing.length + 1)
    }
    else {
      const delimiters = dynamicKeyDelimiters(logicalPath)
      if (delimiters) {
        const extracted = extractDynamicKeyFromRest(rest, delimiters)
        nextKey = extracted.key
        nextRest = extracted.nextRest
      }
      else {
        const head = splitHead(rest)
        nextKey = head.head
        nextRest = head.tail
      }
    }

    if (!nextKey) {
      break
    }

    segments.push(nextKey)
    logicalPath = [...logicalPath, nextKey]
    rest = nextRest
    const nextObject: unknown = current ? current[nextKey] : null
    current = isRecord(nextObject) ? nextObject : null
  }

  return segments
}

const resolvePatchSegments = (snapshot: Snapshot, path: string): string[] => {
  const { root, subPath } = splitPatchPath(path)

  if (root === 'data') {
    return resolveDataPath(snapshot, subPath)
  }

  if (!subPath) {
    return [root]
  }

  return [root, ...splitSegments(subPath)]
}

const getParentContainer = (
  target: Record<string, unknown>,
  segments: string[],
  create: boolean
): Record<string, unknown> | null => {
  if (segments.length === 0) {
    return null
  }

  let current: Record<string, unknown> = target
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]
    const next = current[key]

    if (isRecord(next)) {
      current = next
      continue
    }

    if (!create) {
      return null
    }

    const created: Record<string, unknown> = {}
    current[key] = created
    current = created
  }

  return current
}

const applyPatchToSnapshot = (
  snapshot: Snapshot,
  patch: { op: 'set' | 'unset' | 'merge'; path: string; value?: unknown }
): Snapshot => {
  const next = structuredClone(snapshot) as Record<string, unknown>
  const nextSnapshot = next as Snapshot
  const segments = resolvePatchSegments(nextSnapshot, patch.path)

  if (segments.length === 0) {
    return nextSnapshot
  }

  if (patch.op === 'unset') {
    const parent = getParentContainer(next, segments, false)
    if (parent) {
      delete parent[segments[segments.length - 1]]
    }
    return nextSnapshot
  }

  const parent = getParentContainer(next, segments, true)
  if (!parent) {
    return nextSnapshot
  }

  const key = segments[segments.length - 1]
  if (patch.op === 'set') {
    parent[key] = patch.value
    return nextSnapshot
  }

  const existing = parent[key]
  parent[key] = {
    ...(isRecord(existing) ? existing : {}),
    ...(isRecord(patch.value) ? patch.value : {})
  }

  return nextSnapshot
}

const applyDeltaToSnapshot = (
  base: Snapshot,
  patches: WorldDelta['patches']
): Snapshot => {
  let snapshot = structuredClone(base) as Snapshot
  for (const patch of patches) {
    snapshot = applyPatchToSnapshot(snapshot, patch)
  }
  return sanitizeSnapshot(snapshot)
}

type StoredWorld = {
  world: World
  delta: WorldDelta
}

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
  private readonly worlds = new Map<WorldId, StoredWorld>()
  private readonly snapshots = new Map<WorldId, Snapshot>()
  private readonly children = new Map<WorldId, Set<WorldId>>()
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
    this.worlds.clear()
    this.snapshots.clear()
    this.children.clear()

    const genesis = this.payload.genesis
    if (!genesis) {
      return
    }

    const genesisDelta: WorldDelta = {
      fromWorld: genesis.world.worldId,
      toWorld: genesis.world.worldId,
      patches: [],
      createdAt: genesis.world.createdAt
    }

    this.worlds.set(genesis.world.worldId, {
      world: genesis.world,
      delta: genesisDelta
    })
    this.snapshots.set(genesis.world.worldId, sanitizeSnapshot(genesis.snapshot))
    this.children.set(genesis.world.worldId, new Set())

    for (const entry of this.payload.entries) {
      const parentSnapshot = this.snapshots.get(entry.delta.fromWorld)
      if (!parentSnapshot) {
        continue
      }

      const snapshot = applyDeltaToSnapshot(parentSnapshot, entry.delta.patches)
      this.worlds.set(entry.world.worldId, {
        world: entry.world,
        delta: entry.delta
      })
      this.snapshots.set(entry.world.worldId, snapshot)

      if (!this.children.has(entry.world.worldId)) {
        this.children.set(entry.world.worldId, new Set())
      }

      if (entry.delta.fromWorld !== entry.world.worldId) {
        if (!this.children.has(entry.delta.fromWorld)) {
          this.children.set(entry.delta.fromWorld, new Set())
        }
        this.children.get(entry.delta.fromWorld)?.add(entry.world.worldId)
      }
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
    const sanitizedSnapshot = sanitizeSnapshot(snapshot)
    const genesisDelta: WorldDelta = {
      fromWorld: world.worldId,
      toWorld: world.worldId,
      patches: [],
      createdAt: world.createdAt
    }

    this.worlds.clear()
    this.snapshots.clear()
    this.children.clear()

    this.worlds.set(world.worldId, {
      world,
      delta: genesisDelta
    })
    this.snapshots.set(world.worldId, sanitizedSnapshot)
    this.children.set(world.worldId, new Set())

    this.payload.genesis = {
      world,
      snapshot: sanitizedSnapshot
    }
    this.payload.entries = []
    this.schedulePersist()
  }

  async store(world: World, delta: WorldDelta): Promise<void> {
    const parentSnapshot = this.snapshots.get(delta.fromWorld)
    if (!parentSnapshot) {
      throw new Error(`Parent snapshot not found for World: ${String(delta.fromWorld)}`)
    }

    const snapshot = applyDeltaToSnapshot(parentSnapshot, delta.patches)

    this.worlds.set(world.worldId, {
      world,
      delta
    })
    this.snapshots.set(world.worldId, snapshot)

    if (!this.children.has(world.worldId)) {
      this.children.set(world.worldId, new Set())
    }

    if (delta.fromWorld !== world.worldId) {
      if (!this.children.has(delta.fromWorld)) {
        this.children.set(delta.fromWorld, new Set())
      }
      this.children.get(delta.fromWorld)?.add(world.worldId)
    }

    this.payload.entries.push({ world, delta })
    this.schedulePersist()
  }

  async restore(worldId: WorldId): Promise<Snapshot> {
    const snapshot = this.snapshots.get(worldId)
    if (!snapshot) {
      throw new Error(`World not found: ${String(worldId)}`)
    }
    return structuredClone(snapshot) as Snapshot
  }

  async getWorld(worldId: WorldId): Promise<World | null> {
    return this.worlds.get(worldId)?.world ?? null
  }

  async has(worldId: WorldId): Promise<boolean> {
    return this.worlds.has(worldId)
  }

  async getChildren(worldId: WorldId): Promise<readonly WorldId[]> {
    const children = this.children.get(worldId)
    return children ? Array.from(children) : []
  }

  async getLineage(worldId: WorldId): Promise<readonly WorldId[]> {
    const lineage: WorldId[] = []
    let current: WorldId | null = worldId
    const visited = new Set<WorldId>()

    while (current && !visited.has(current)) {
      visited.add(current)
      lineage.push(current)

      const entry = this.worlds.get(current)
      if (!entry) {
        break
      }

      const parent = entry.delta.fromWorld
      if (parent === current) {
        break
      }

      current = parent
    }

    return lineage
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
