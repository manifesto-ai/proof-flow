import path from 'node:path'
import * as vscode from 'vscode'
import type { App } from '@manifesto-ai/app'
import type { ProofFlowState } from '@proof-flow/schema'
import { resolveNodeIdAtCursor } from '@proof-flow/host'
import { createProofFlowApp } from './config.js'
import {
  DagSyncController,
  type DagSyncReason,
  type ScheduleDagSyncOptions
} from './dag-sync-controller.js'
import {
  createVscodeProofFlowEffects,
  isLeanDocument,
  isLeanUri
} from './effects-adapter.js'
import type { ProjectionState } from './projection-state.js'
import { resolveRuntimeDebug } from './runtime-debug.js'
import {
  ProjectionPanelController,
  selectProjectionState
} from './webview-panel.js'

let app: App | null = null
let panelController: ProjectionPanelController | null = null
let dagSyncController: DagSyncController | null = null

const proofFlowEffects = createVscodeProofFlowEffects()

const tryReadUtf8 = async (uri: vscode.Uri): Promise<string | null> => {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri)
    return new TextDecoder().decode(bytes)
  }
  catch {
    return null
  }
}

const resolveConfiguredSchemaUri = (): vscode.Uri | null => {
  const configured = vscode.workspace
    .getConfiguration('proofFlow')
    .get<string>('schemaPath')
    ?.trim()

  if (!configured) {
    return null
  }

  const workspace = vscode.workspace.workspaceFolders?.[0]
  const isUriLike = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(configured)
  if (isUriLike) {
    try {
      return vscode.Uri.parse(configured)
    }
    catch {
      return null
    }
  }

  if (path.isAbsolute(configured)) {
    return vscode.Uri.file(configured)
  }

  if (!workspace) {
    return null
  }

  return vscode.Uri.joinPath(workspace.uri, configured)
}

const readDomainMel = async (context: vscode.ExtensionContext): Promise<string> => {
  const configuredUri = resolveConfiguredSchemaUri()
  const workspace = vscode.workspace.workspaceFolders?.[0]
  const extensionUri = context.extensionUri

  const candidates = [
    configuredUri,
    extensionUri
      ? vscode.Uri.joinPath(extensionUri, '..', 'schema', 'domain.mel')
      : null,
    extensionUri
      ? vscode.Uri.joinPath(extensionUri, 'node_modules', '@proof-flow', 'schema', 'domain.mel')
      : null,
    workspace
      ? vscode.Uri.joinPath(workspace.uri, 'packages', 'schema', 'domain.mel')
      : null
  ].filter((candidate): candidate is vscode.Uri => Boolean(candidate))

  for (const candidate of candidates) {
    const content = await tryReadUtf8(candidate)
    if (content !== null) {
      return content
    }
  }

  throw new Error('ProofFlow schema (domain.mel) not found. Set `proofFlow.schemaPath` if needed.')
}

const ensureApp = async (context: vscode.ExtensionContext): Promise<App> => {
  if (app) {
    return app
  }

  const workspace = vscode.workspace.workspaceFolders?.[0]
  if (!workspace) {
    throw new Error('ProofFlow requires an opened workspace folder.')
  }

  const schema = await readDomainMel(context)
  app = createProofFlowApp({
    schema,
    effects: proofFlowEffects
  })
  await app.ready()
  return app
}

const actSafely = async (type: string, input?: unknown): Promise<void> => {
  if (!app) {
    return
  }

  try {
    await app.act(type, input).done()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void vscode.window.showWarningMessage(`[ProofFlow] ${type} failed: ${message}`)
  }
}

const ensureDagSyncController = (): DagSyncController => {
  if (dagSyncController) {
    return dagSyncController
  }

  dagSyncController = new DagSyncController(async (fileUri) => {
    await actSafely('dag_sync', { fileUri })
    await actSafely('sorry_queue_refresh')
    await actSafely('breakage_analyze')
  })
  return dagSyncController
}

const scheduleDagSync = (
  fileUri: string,
  reason: DagSyncReason,
  options: ScheduleDagSyncOptions = {}
): Promise<void> => ensureDagSyncController().schedule(fileUri, reason, options)

const clearDagSyncQueue = (): void => {
  dagSyncController?.clear()
  dagSyncController = null
}

type LineageDiffInput = {
  fileUri?: string
  limit?: number
  includeDiagnostics?: boolean
}

type LineageNodeLite = {
  nodeId: string
  startLine: number | null
  statusKind: string | null
  goalCurrent: string | null
}

type LineageDagLite = {
  extractedAt: number | null
  nodes: Record<string, LineageNodeLite>
}

type LineageWorldEntry = {
  worldId: string
  createdAt: number | null
  snapshot: unknown
  index: number
}

type LineageDiffNodeRef = {
  nodeId: string
  startLine: number | null
}

type LineageStatusChange = LineageDiffNodeRef & {
  fromStatus: string | null
  toStatus: string | null
}

type LineageGoalChange = LineageDiffNodeRef & {
  fromGoal: string | null
  toGoal: string | null
}

type LineageDiffEntry = {
  fromWorldId: string
  toWorldId: string
  fromCreatedAt: number | null
  toCreatedAt: number | null
  fromExtractedAt: number | null
  toExtractedAt: number | null
  counts: {
    added: number
    removed: number
    statusChanged: number
    goalChanged: number
  }
  addedNodes: LineageDiffNodeRef[]
  removedNodes: LineageDiffNodeRef[]
  statusChanges: LineageStatusChange[]
  goalChanges: LineageGoalChange[]
}

type LineageProbeEntry = {
  worldId: string
  createdAt: number | null
  worldOk: boolean
  worldKeys: string[]
  snapshotOk: boolean
  snapshotKeys: string[]
  computedKeys: string[]
  computedActiveDagFileUri: string | null
  computedActiveDagNodeCount: number
  dataKeys: string[]
  fileUris: string[]
  matchedFileKey: string | null
  fileStateKeys: string[]
  fileLeanKeys: string[]
  fileCount: number
  hasTargetFile: boolean
  hasDag: boolean
  dagNodeCount: number
  extractedAt: number | null
  worldError: string | null
  snapshotError: string | null
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const asString = (value: unknown): string | null => (
  typeof value === 'string' && value.length > 0 ? value : null
)

const asNullableNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
)

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }

  return String(error)
}

const parseLineageDiffInput = (params: unknown): Required<LineageDiffInput> => {
  const record = asRecord(params)
  const limitRaw = record?.limit
  const parsedLimit = typeof limitRaw === 'number' && Number.isFinite(limitRaw)
    ? Math.floor(limitRaw)
    : 64
  const normalizedLimit = Math.max(2, Math.min(parsedLimit, 1024))

  return {
    fileUri: asString(record?.fileUri) ?? '',
    limit: normalizedLimit,
    includeDiagnostics: record?.includeDiagnostics === true
  }
}

const extractProofFlowData = (snapshot: unknown): Record<string, unknown> | null => {
  const snapshotRecord = asRecord(snapshot)
  if (!snapshotRecord) {
    return null
  }

  if (asRecord(snapshotRecord.files)) {
    return snapshotRecord
  }

  const nestedData = asRecord(snapshotRecord.data)
  if (nestedData && asRecord(nestedData.files)) {
    return nestedData
  }

  return null
}

const toComparablePath = (value: string): string | null => {
  if (value.length === 0) {
    return null
  }

  try {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
      return path.normalize(vscode.Uri.parse(value).fsPath)
    }
  }
  catch {
    // Fall through to path-like matching.
  }

  if (path.isAbsolute(value)) {
    return path.normalize(value)
  }

  return null
}

const resolveFileStateFromFiles = (
  files: Record<string, unknown> | null,
  fileUri: string
): { key: string | null; state: Record<string, unknown> | null } => {
  if (!files) {
    return { key: null, state: null }
  }

  const exact = asRecord(files[fileUri])
  if (exact) {
    return { key: fileUri, state: exact }
  }

  const targetPath = toComparablePath(fileUri)
  if (targetPath) {
    for (const [key, value] of Object.entries(files)) {
      const candidatePath = toComparablePath(key)
      if (candidatePath && candidatePath === targetPath) {
        const state = asRecord(value)
        if (state) {
          return { key, state }
        }
      }
    }
  }

  const keys = Object.keys(files)
  if (keys.length === 1) {
    const onlyKey = keys[0] ?? null
    return {
      key: onlyKey,
      state: onlyKey ? asRecord(files[onlyKey]) : null
    }
  }

  return { key: null, state: null }
}

const resolveDagFromComputed = (
  snapshotRecord: Record<string, unknown> | null,
  fileUri: string
): Record<string, unknown> | null => {
  if (!snapshotRecord) {
    return null
  }

  const computed = asRecord(snapshotRecord.computed)
  if (!computed) {
    return null
  }

  const candidate = asRecord(computed['computed.activeDag']) ?? asRecord(computed.activeDag)
  if (!candidate) {
    return null
  }

  const candidateFileUri = asString(candidate.fileUri)
  if (!candidateFileUri) {
    return candidate
  }

  const targetPath = toComparablePath(fileUri)
  const candidatePath = toComparablePath(candidateFileUri)
  if (!targetPath || !candidatePath) {
    return candidateFileUri === fileUri ? candidate : null
  }

  return candidatePath === targetPath ? candidate : null
}

const resolveDagFromFileState = (
  fileState: Record<string, unknown> | null
): Record<string, unknown> | null => {
  if (!fileState) {
    return null
  }

  const directDag = asRecord(fileState.dag)
  if (directDag) {
    return directDag
  }

  const lean = asRecord(fileState.lean)
  return lean ? asRecord(lean.dag) : null
}

const shouldIncludeNode = (
  nodeId: string,
  includeDiagnostics: boolean
): boolean => {
  if (nodeId === 'root') {
    return false
  }

  if (!includeDiagnostics && nodeId.startsWith('diag:')) {
    return false
  }

  return true
}

const extractLineageDag = (
  snapshot: unknown,
  fileUri: string,
  includeDiagnostics: boolean
): LineageDagLite | null => {
  const snapshotRecord = asRecord(snapshot)
  const data = extractProofFlowData(snapshot)
  if (!data) {
    return null
  }

  const files = asRecord(data.files)
  const fileResolved = resolveFileStateFromFiles(files, fileUri)
  const fileState = fileResolved.state
  const dag = (
    resolveDagFromFileState(fileState)
    ?? resolveDagFromComputed(snapshotRecord, fileUri)
  )
  if (!dag) {
    return null
  }

  const nodesRecord = asRecord(dag.nodes)
  const nodes: Record<string, LineageNodeLite> = {}

  if (nodesRecord) {
    for (const [nodeId, rawNode] of Object.entries(nodesRecord)) {
      if (!shouldIncludeNode(nodeId, includeDiagnostics)) {
        continue
      }

      const node = asRecord(rawNode)
      if (!node) {
        continue
      }

      const status = asRecord(node.status)
      const range = asRecord(node.leanRange)

      nodes[nodeId] = {
        nodeId,
        startLine: asNullableNumber(range?.startLine),
        statusKind: asString(status?.kind),
        goalCurrent: asString(node.goalCurrent)
      }
    }
  }

  return {
    extractedAt: asNullableNumber(dag.extractedAt),
    nodes
  }
}

const compareNodeRef = (
  left: LineageDiffNodeRef,
  right: LineageDiffNodeRef
): number => {
  const leftLine = left.startLine ?? Number.MAX_SAFE_INTEGER
  const rightLine = right.startLine ?? Number.MAX_SAFE_INTEGER
  if (leftLine !== rightLine) {
    return leftLine - rightLine
  }

  return left.nodeId.localeCompare(right.nodeId)
}

const createNodeRef = (node: LineageNodeLite | null | undefined, nodeId: string): LineageDiffNodeRef => ({
  nodeId,
  startLine: node?.startLine ?? null
})

const diffLineageDag = (
  fromWorld: LineageWorldEntry,
  toWorld: LineageWorldEntry,
  fromDag: LineageDagLite | null,
  toDag: LineageDagLite | null
): LineageDiffEntry => {
  const fromNodes = fromDag?.nodes ?? {}
  const toNodes = toDag?.nodes ?? {}

  const addedNodes: LineageDiffNodeRef[] = []
  const removedNodes: LineageDiffNodeRef[] = []
  const statusChanges: LineageStatusChange[] = []
  const goalChanges: LineageGoalChange[] = []

  for (const [nodeId, node] of Object.entries(toNodes)) {
    if (!fromNodes[nodeId]) {
      addedNodes.push(createNodeRef(node, nodeId))
    }
  }

  for (const [nodeId, node] of Object.entries(fromNodes)) {
    if (!toNodes[nodeId]) {
      removedNodes.push(createNodeRef(node, nodeId))
    }
  }

  for (const [nodeId, fromNode] of Object.entries(fromNodes)) {
    const toNode = toNodes[nodeId]
    if (!toNode) {
      continue
    }

    if (fromNode.statusKind !== toNode.statusKind) {
      statusChanges.push({
        ...createNodeRef(toNode ?? fromNode, nodeId),
        fromStatus: fromNode.statusKind,
        toStatus: toNode.statusKind
      })
    }

    if (fromNode.goalCurrent !== toNode.goalCurrent) {
      goalChanges.push({
        ...createNodeRef(toNode ?? fromNode, nodeId),
        fromGoal: fromNode.goalCurrent,
        toGoal: toNode.goalCurrent
      })
    }
  }

  addedNodes.sort(compareNodeRef)
  removedNodes.sort(compareNodeRef)
  statusChanges.sort(compareNodeRef)
  goalChanges.sort(compareNodeRef)

  return {
    fromWorldId: fromWorld.worldId,
    toWorldId: toWorld.worldId,
    fromCreatedAt: fromWorld.createdAt,
    toCreatedAt: toWorld.createdAt,
    fromExtractedAt: fromDag?.extractedAt ?? null,
    toExtractedAt: toDag?.extractedAt ?? null,
    counts: {
      added: addedNodes.length,
      removed: removedNodes.length,
      statusChanged: statusChanges.length,
      goalChanged: goalChanges.length
    },
    addedNodes,
    removedNodes,
    statusChanges,
    goalChanges
  }
}

const resolveLineageFileUri = (
  preferredFileUri: string,
  state: ProofFlowState
): string | null => {
  if (preferredFileUri.length > 0) {
    return preferredFileUri
  }

  if (state.activeFileUri) {
    return state.activeFileUri
  }

  const candidates = Object.keys(state.files)
  return candidates.length > 0 ? candidates[0] ?? null : null
}

type WorldHeadsSnapshot = {
  measuredAt: string
  current: {
    branchId: string | null
    branchName: string | null
    schemaHash: string | null
    headWorldId: string | null
    lineageLength: number
  }
  heads: Array<{
    worldId: string
    branchId: string
    branchName: string
    createdAt: number
    schemaHash: string
  }>
  latestHead: {
    worldId: string
    branchId: string
    branchName: string
    createdAt: number
    schemaHash: string
  } | null
  stateSummary: {
    fileCount: number
    dagNodeCount: number
  }
}

const snapshotWorldHeads = async (): Promise<WorldHeadsSnapshot | null> => {
  if (!app) {
    return null
  }

  const branch = app.currentBranch()
  const state = app.getState<ProofFlowState>().data
  const heads = (await app.getHeads?.()) ?? []
  const latestHead = (await app.getLatestHead?.()) ?? null

  const dagNodeCount = Object.values(state.files).reduce((sum, file) => (
    sum + (file.dag ? Object.keys(file.dag.nodes).length : 0)
  ), 0)

  return {
    measuredAt: new Date().toISOString(),
    current: {
      branchId: branch.id ?? null,
      branchName: branch.name ?? null,
      schemaHash: branch.schemaHash ?? null,
      headWorldId: app.getCurrentHead?.() ?? branch.head?.() ?? null,
      lineageLength: branch.lineage({ limit: 4096 }).length
    },
    heads: heads.map((entry) => ({
      worldId: entry.worldId,
      branchId: entry.branchId,
      branchName: entry.branchName,
      createdAt: entry.createdAt,
      schemaHash: entry.schemaHash
    })),
    latestHead: latestHead
      ? {
          worldId: latestHead.worldId,
          branchId: latestHead.branchId,
          branchName: latestHead.branchName,
          createdAt: latestHead.createdAt,
          schemaHash: latestHead.schemaHash
        }
      : null,
    stateSummary: {
      fileCount: Object.keys(state.files).length,
      dagNodeCount
    }
  }
}

const snapshotLineageProbe = async (
  input: Required<LineageDiffInput>
): Promise<Record<string, unknown> | null> => {
  const runtimeApp = app
  if (!runtimeApp) {
    return null
  }

  const branch = runtimeApp.currentBranch()
  const state = runtimeApp.getState<ProofFlowState>().data
  const fileUri = resolveLineageFileUri(input.fileUri, state)
  if (!fileUri) {
    return {
      measuredAt: new Date().toISOString(),
      error: 'NO_ACTIVE_FILE'
    }
  }

  const rawLineage = branch.lineage({ limit: input.limit })
  const deduped = [...new Set(rawLineage.filter((worldId) => typeof worldId === 'string' && worldId.length > 0))]
  const headWorldId = runtimeApp.getCurrentHead?.() ?? branch.head?.() ?? null
  const worldIds = headWorldId && deduped[0] === headWorldId ? [...deduped].reverse() : deduped

  const getWorld = runtimeApp.getWorld as unknown as ((this: App, id: string) => Promise<unknown>) | undefined
  const getSnapshot = runtimeApp.getSnapshot as unknown as ((this: App, id: string) => Promise<unknown>) | undefined

  const entries: LineageProbeEntry[] = []
  for (const worldId of worldIds) {
    let world: unknown = null
    let snapshot: unknown = null
    let worldError: string | null = null
    let snapshotError: string | null = null

    if (getWorld) {
      try {
        world = await getWorld.call(runtimeApp, worldId)
      }
      catch (error) {
        worldError = toErrorMessage(error)
      }
    }
    else {
      worldError = 'METHOD_UNAVAILABLE'
    }

    if (getSnapshot) {
      try {
        snapshot = await getSnapshot.call(runtimeApp, worldId)
      }
      catch (error) {
        snapshotError = toErrorMessage(error)
      }
    }
    else {
      snapshotError = 'METHOD_UNAVAILABLE'
    }

    const worldRecord = asRecord(world)
    const snapshotRecord = asRecord(snapshot)
    const computed = snapshotRecord ? asRecord(snapshotRecord.computed) : null
    const computedActiveDag = (
      computed
        ? asRecord(computed['computed.activeDag']) ?? asRecord(computed.activeDag)
        : null
    )
    const computedActiveDagNodes = computedActiveDag ? asRecord(computedActiveDag.nodes) : null
    const extractedData = extractProofFlowData(snapshot)
    const files = extractedData ? asRecord(extractedData.files) : null
    const fileResolved = resolveFileStateFromFiles(files, fileUri)
    const targetFile = fileResolved.state
    const leanFile = targetFile ? asRecord(targetFile.lean) : null
    const dag = resolveDagFromFileState(targetFile)
    const nodes = dag ? asRecord(dag.nodes) : null

    entries.push({
      worldId,
      createdAt: asNullableNumber(worldRecord?.createdAt),
      worldOk: Boolean(worldRecord),
      worldKeys: worldRecord ? Object.keys(worldRecord) : [],
      snapshotOk: Boolean(snapshotRecord),
      snapshotKeys: snapshotRecord ? Object.keys(snapshotRecord) : [],
      computedKeys: computed ? Object.keys(computed) : [],
      computedActiveDagFileUri: asString(computedActiveDag?.fileUri),
      computedActiveDagNodeCount: computedActiveDagNodes ? Object.keys(computedActiveDagNodes).length : 0,
      dataKeys: extractedData ? Object.keys(extractedData) : [],
      fileUris: files ? Object.keys(files).slice(0, 5) : [],
      matchedFileKey: fileResolved.key,
      fileStateKeys: targetFile ? Object.keys(targetFile) : [],
      fileLeanKeys: leanFile ? Object.keys(leanFile) : [],
      fileCount: files ? Object.keys(files).length : 0,
      hasTargetFile: Boolean(targetFile),
      hasDag: Boolean(dag),
      dagNodeCount: nodes ? Object.keys(nodes).length : 0,
      extractedAt: asNullableNumber(dag?.extractedAt),
      worldError,
      snapshotError
    })
  }

  return {
    measuredAt: new Date().toISOString(),
    branch: {
      branchId: branch.id ?? null,
      branchName: branch.name ?? null,
      headWorldId,
      lineageLength: worldIds.length
    },
    fileUri,
    methods: {
      hasGetWorld: typeof getWorld === 'function',
      hasGetSnapshot: typeof getSnapshot === 'function'
    },
    entries
  }
}

const snapshotLineageDiff = async (
  input: Required<LineageDiffInput>
): Promise<Record<string, unknown> | null> => {
  const runtimeApp = app
  if (!runtimeApp) {
    return null
  }

  const branch = runtimeApp.currentBranch()
  const state = runtimeApp.getState<ProofFlowState>().data
  const fileUri = resolveLineageFileUri(input.fileUri, state)

  if (!fileUri) {
    return {
      measuredAt: new Date().toISOString(),
      error: 'NO_ACTIVE_FILE'
    }
  }

  const headWorldId = runtimeApp.getCurrentHead?.() ?? branch.head?.() ?? null
  const rawLineage = branch.lineage({ limit: input.limit })
  const deduped = [...new Set(rawLineage.filter((worldId) => typeof worldId === 'string' && worldId.length > 0))]
  let lineageWorldIds = [...deduped]
  const getWorld = runtimeApp.getWorld as unknown as ((this: App, id: string) => Promise<unknown>) | undefined
  const getSnapshot = runtimeApp.getSnapshot as unknown as ((this: App, id: string) => Promise<unknown>) | undefined

  if (headWorldId && lineageWorldIds[0] === headWorldId) {
    lineageWorldIds = [...lineageWorldIds].reverse()
  }

  const worldEntries = await Promise.all(
    lineageWorldIds.map(async (worldId, index): Promise<LineageWorldEntry> => {
      let createdAt: number | null = null
      let snapshot: unknown = null

      try {
        const world = getWorld ? await getWorld.call(runtimeApp, worldId) : null
        createdAt = asNullableNumber(asRecord(world)?.createdAt)
      }
      catch {
        createdAt = null
      }

      try {
        snapshot = getSnapshot ? await getSnapshot.call(runtimeApp, worldId) : null
      }
      catch {
        snapshot = null
      }

      return {
        worldId,
        createdAt,
        snapshot,
        index
      }
    })
  )

  const hasCreatedAt = worldEntries.some((entry) => entry.createdAt !== null)
  const orderedEntries = hasCreatedAt
    ? [...worldEntries].sort((left, right) => {
        const leftTime = left.createdAt ?? Number.MAX_SAFE_INTEGER
        const rightTime = right.createdAt ?? Number.MAX_SAFE_INTEGER
        if (leftTime !== rightTime) {
          return leftTime - rightTime
        }
        return left.index - right.index
      })
    : worldEntries

  const dagByWorldId = new Map<string, LineageDagLite | null>()
  for (const entry of orderedEntries) {
    dagByWorldId.set(
      entry.worldId,
      extractLineageDag(entry.snapshot, fileUri, input.includeDiagnostics)
    )
  }

  const diffs: LineageDiffEntry[] = []
  for (let index = 1; index < orderedEntries.length; index += 1) {
    const fromEntry = orderedEntries[index - 1]
    const toEntry = orderedEntries[index]
    if (!fromEntry || !toEntry) {
      continue
    }

    diffs.push(
      diffLineageDag(
        fromEntry,
        toEntry,
        dagByWorldId.get(fromEntry.worldId) ?? null,
        dagByWorldId.get(toEntry.worldId) ?? null
      )
    )
  }

  const summary = diffs.reduce(
    (acc, entry) => ({
      edges: acc.edges + 1,
      added: acc.added + entry.counts.added,
      removed: acc.removed + entry.counts.removed,
      statusChanged: acc.statusChanged + entry.counts.statusChanged,
      goalChanged: acc.goalChanged + entry.counts.goalChanged
    }),
    {
      edges: 0,
      added: 0,
      removed: 0,
      statusChanged: 0,
      goalChanged: 0
    }
  )

  return {
    measuredAt: new Date().toISOString(),
    branch: {
      branchId: branch.id ?? null,
      branchName: branch.name ?? null,
      headWorldId,
      lineageLength: orderedEntries.length
    },
    fileUri,
    options: {
      limit: input.limit,
      includeDiagnostics: input.includeDiagnostics
    },
    worldIds: orderedEntries.map((entry) => entry.worldId),
    summary,
    diffs
  }
}

export async function activate(context: vscode.ExtensionContext) {
  clearDagSyncQueue()

  panelController = new ProjectionPanelController(context, {
    onNodeSelect: async (nodeId) => {
      await actSafely('node_select', { nodeId })
    },
    onTogglePanel: async () => {
      const visible = app?.getState<ProofFlowState>().data.panelVisible ?? true
      await actSafely('panel_set', { visible: !visible })
    }
  })
  context.subscriptions.push(panelController)

  let readyApp: App
  try {
    readyApp = await ensureApp(context)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void vscode.window.showErrorMessage(`[ProofFlow] Activation failed: ${message}`)
    return
  }

  const unsubscribeProjection = readyApp.subscribe(
    (state) => selectProjectionState(state),
    (projection) => {
      const projectionState: ProjectionState = {
        ...projection,
        runtimeDebug: resolveRuntimeDebug(app)
      }
      panelController?.setState(projectionState)
    },
    { fireImmediately: true }
  )
  context.subscriptions.push(new vscode.Disposable(unsubscribeProjection))

  const togglePanel = vscode.commands.registerCommand('proof-flow.hello', async () => {
    const visible = app?.getState<ProofFlowState>().data.panelVisible ?? false

    if (visible && !panelController?.isOpen()) {
      panelController?.reveal()
      return
    }

    await actSafely('panel_set', { visible: !visible })

    const nextVisible = app?.getState<ProofFlowState>().data.panelVisible ?? false
    if (nextVisible) {
      panelController?.reveal()
    }
  })

  const worldHeadsSnapshotCommand = vscode.commands.registerCommand(
    'proof-flow.worldHeadsSnapshot',
    async () => snapshotWorldHeads()
  )

  const lineageDiffReportCommand = vscode.commands.registerCommand(
    'proof-flow.lineageDiffReport',
    async (params?: unknown) => snapshotLineageDiff(parseLineageDiffInput(params))
  )

  const lineageSnapshotProbeCommand = vscode.commands.registerCommand(
    'proof-flow.lineageSnapshotProbe',
    async (params?: unknown) => snapshotLineageProbe(parseLineageDiffInput(params))
  )

  const onEditorChange = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (!editor || !isLeanDocument(editor.document)) {
      return
    }

    const fileUri = editor.document.uri.toString()
    await actSafely('file_activate', { fileUri })
    void scheduleDagSync(fileUri, 'activate')
  })

  const onDocumentSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (!isLeanDocument(document)) {
      return
    }

    const fileUri = document.uri.toString()
    void scheduleDagSync(fileUri, 'save')
  })

  const onDiagnosticsChange = vscode.languages.onDidChangeDiagnostics(async (event) => {
    const leanUris = event.uris.filter((uri) => isLeanUri(uri))
    for (const uri of leanUris) {
      const fileUri = uri.toString()
      void scheduleDagSync(fileUri, 'diagnostics')
    }
  })

  const onSelectionChange = vscode.window.onDidChangeTextEditorSelection(async (event) => {
    if (!app || !isLeanDocument(event.textEditor.document)) {
      return
    }

    const fileUri = event.textEditor.document.uri.toString()
    const state = app.getState<ProofFlowState>().data
    const dag = state.files[fileUri]?.dag
    const nodeId = dag
      ? resolveNodeIdAtCursor(dag, {
          fileUri,
          position: {
            line: event.selections[0]?.active.line + 1,
            column: event.selections[0]?.active.character ?? 0
          }
        })
      : null

    await actSafely('cursor_sync', {
      resolvedNodeId: nodeId
    })
  })

  context.subscriptions.push(
    togglePanel,
    worldHeadsSnapshotCommand,
    lineageDiffReportCommand,
    lineageSnapshotProbeCommand,
    onEditorChange,
    onDocumentSave,
    onDiagnosticsChange,
    onSelectionChange
  )

  const activeEditor = vscode.window.activeTextEditor
  if (activeEditor && isLeanDocument(activeEditor.document)) {
    const fileUri = activeEditor.document.uri.toString()
    await actSafely('file_activate', { fileUri })
    await scheduleDagSync(fileUri, 'startup')
  }
}

export async function deactivate() {
  clearDagSyncQueue()
  panelController?.dispose()
  panelController = null

  if (!app) {
    return
  }

  await app.dispose()
  app = null
}
