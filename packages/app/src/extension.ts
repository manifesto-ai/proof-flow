import path from 'node:path'
import * as vscode from 'vscode'
import type { App } from '@manifesto-ai/app'
import type { Goal, ProofFlowState, TacticResult } from '@proof-flow/schema'
import { createProofFlowApp } from './config.js'
import {
  createVscodeProofFlowEffects,
  isLeanDocument,
  isLeanUri
} from './effects-adapter.js'
import type { ProjectionState } from './projection-state.js'
import {
  ProjectionPanelController,
  selectProjectionState
} from './webview-panel.js'

let app: App | null = null
let panelController: ProjectionPanelController | null = null
let panelVisible = true

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

const parseLineageDiffInput = (params: unknown): { limit: number } => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return { limit: 128 }
  }

  const limit = (params as { limit?: unknown }).limit
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return { limit: 128 }
  }

  return {
    limit: Math.max(2, Math.min(1024, Math.floor(limit)))
  }
}

type GoalLite = {
  id: string
  status: string
  statement: string
}

type LineageDiffEntry = {
  fromWorldId: string
  toWorldId: string
  fromCreatedAt: number | null
  toCreatedAt: number | null
  counts: {
    added: number
    removed: number
    statusChanged: number
  }
  addedGoals: GoalLite[]
  removedGoals: GoalLite[]
  statusChanges: Array<{
    id: string
    fromStatus: string
    toStatus: string
    statement: string
  }>
  fromTacticResult: TacticResult | null
  toTacticResult: TacticResult | null
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const asNullableNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
)

const asString = (value: unknown): string | null => (
  typeof value === 'string' && value.length > 0 ? value : null
)

const extractStateData = (snapshot: unknown): Record<string, unknown> | null => {
  const snapshotRecord = asRecord(snapshot)
  if (!snapshotRecord) {
    return null
  }

  if (asRecord(snapshotRecord.goals)) {
    return snapshotRecord
  }

  const nested = asRecord(snapshotRecord.data)
  if (nested && asRecord(nested.goals)) {
    return nested
  }

  return null
}

const extractGoals = (stateData: Record<string, unknown> | null): Map<string, GoalLite> => {
  const goals = asRecord(stateData?.goals)
  const result = new Map<string, GoalLite>()

  if (!goals) {
    return result
  }

  for (const [goalId, entry] of Object.entries(goals)) {
    const goal = asRecord(entry)
    const id = asString(goal?.id) ?? goalId
    const statement = asString(goal?.statement)
    const status = asString(goal?.status)

    if (!id || !statement || !status) {
      continue
    }

    result.set(id, {
      id,
      status,
      statement
    })
  }

  return result
}

const normalizeTacticResult = (stateData: Record<string, unknown> | null): TacticResult | null => {
  const value = asRecord(stateData?.tacticResult)
  if (!value) {
    return null
  }

  const goalId = asString(value.goalId)
  const tactic = asString(value.tactic)
  const succeeded = value.succeeded
  const newGoalIds = value.newGoalIds

  if (!goalId || !tactic || typeof succeeded !== 'boolean' || !Array.isArray(newGoalIds)) {
    return null
  }

  return {
    goalId,
    tactic,
    succeeded,
    newGoalIds: newGoalIds.filter((entry): entry is string => typeof entry === 'string')
  }
}

const diffGoals = (
  fromGoals: Map<string, GoalLite>,
  toGoals: Map<string, GoalLite>
): Omit<LineageDiffEntry, 'fromWorldId' | 'toWorldId' | 'fromCreatedAt' | 'toCreatedAt' | 'fromTacticResult' | 'toTacticResult'> => {
  const addedGoals: GoalLite[] = []
  const removedGoals: GoalLite[] = []
  const statusChanges: Array<{ id: string; fromStatus: string; toStatus: string; statement: string }> = []

  for (const [id, goal] of toGoals.entries()) {
    if (!fromGoals.has(id)) {
      addedGoals.push(goal)
    }
  }

  for (const [id, goal] of fromGoals.entries()) {
    if (!toGoals.has(id)) {
      removedGoals.push(goal)
      continue
    }

    const nextGoal = toGoals.get(id)
    if (nextGoal && nextGoal.status !== goal.status) {
      statusChanges.push({
        id,
        fromStatus: goal.status,
        toStatus: nextGoal.status,
        statement: nextGoal.statement
      })
    }
  }

  addedGoals.sort((left, right) => left.id.localeCompare(right.id))
  removedGoals.sort((left, right) => left.id.localeCompare(right.id))
  statusChanges.sort((left, right) => left.id.localeCompare(right.id))

  return {
    counts: {
      added: addedGoals.length,
      removed: removedGoals.length,
      statusChanged: statusChanges.length
    },
    addedGoals,
    removedGoals,
    statusChanges
  }
}

const snapshotLineageDiff = async (
  input: { limit: number }
): Promise<Record<string, unknown> | null> => {
  const runtimeApp = app
  if (!runtimeApp) {
    return null
  }

  const branch = runtimeApp.currentBranch()
  const headWorldId = runtimeApp.getCurrentHead?.() ?? branch.head?.() ?? null
  const rawLineage = branch.lineage({ limit: input.limit })
  const deduped = [...new Set(rawLineage.filter((worldId) => typeof worldId === 'string' && worldId.length > 0))]
  const orderedWorldIds = headWorldId && deduped[0] === headWorldId
    ? [...deduped].reverse()
    : deduped

  const getWorld = runtimeApp.getWorld as unknown as ((this: App, id: string) => Promise<unknown>) | undefined
  const getSnapshot = runtimeApp.getSnapshot as unknown as ((this: App, id: string) => Promise<unknown>) | undefined

  const entries = await Promise.all(orderedWorldIds.map(async (worldId) => {
    const world = getWorld ? await getWorld.call(runtimeApp, worldId) : null
    const snapshot = getSnapshot ? await getSnapshot.call(runtimeApp, worldId) : null
    return {
      worldId,
      createdAt: asNullableNumber(asRecord(world)?.createdAt),
      stateData: extractStateData(snapshot)
    }
  }))

  const diffs: LineageDiffEntry[] = []
  for (let index = 1; index < entries.length; index += 1) {
    const fromEntry = entries[index - 1]
    const toEntry = entries[index]
    if (!fromEntry || !toEntry) {
      continue
    }

    const fromGoals = extractGoals(fromEntry.stateData)
    const toGoals = extractGoals(toEntry.stateData)

    diffs.push({
      fromWorldId: fromEntry.worldId,
      toWorldId: toEntry.worldId,
      fromCreatedAt: fromEntry.createdAt,
      toCreatedAt: toEntry.createdAt,
      ...diffGoals(fromGoals, toGoals),
      fromTacticResult: normalizeTacticResult(fromEntry.stateData),
      toTacticResult: normalizeTacticResult(toEntry.stateData)
    })
  }

  const summary = diffs.reduce((acc, entry) => ({
    edges: acc.edges + 1,
    added: acc.added + entry.counts.added,
    removed: acc.removed + entry.counts.removed,
    statusChanged: acc.statusChanged + entry.counts.statusChanged
  }), {
    edges: 0,
    added: 0,
    removed: 0,
    statusChanged: 0
  })

  return {
    measuredAt: new Date().toISOString(),
    branch: {
      branchId: branch.id ?? null,
      branchName: branch.name ?? null,
      headWorldId,
      lineageLength: entries.length
    },
    summary,
    worldIds: entries.map((entry) => entry.worldId),
    diffs
  }
}

export async function activate(context: vscode.ExtensionContext) {
  panelController = new ProjectionPanelController(context, {
    onSelectGoal: async (goalId) => {
      await actSafely('selectGoal', { goalId })
    },
    onApplyTactic: async (goalId, tactic) => {
      await actSafely('applyTactic', { goalId, tactic })
    },
    onCommitTactic: async () => {
      await actSafely('commitTactic')
    },
    onDismissTactic: async () => {
      await actSafely('dismissTactic')
    },
    onTogglePanel: async () => {
      panelVisible = !panelVisible
      if (panelVisible) {
        panelController?.reveal()
      }
      publishPanelState()
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

  const publishPanelState = (): void => {
    if (!app) {
      return
    }

    const projection = selectProjectionState(app.getState(), panelVisible)
    panelController?.setState(projection)
  }

  const unsubscribeProjection = readyApp.subscribe(
    (state) => selectProjectionState(state, panelVisible),
    (projection: ProjectionState) => {
      panelController?.setState(projection)
    },
    { fireImmediately: true }
  )
  context.subscriptions.push(new vscode.Disposable(unsubscribeProjection))

  const syncGoals = async (): Promise<void> => {
    await actSafely('syncGoals')
  }

  const togglePanel = vscode.commands.registerCommand('proof-flow.hello', async () => {
    panelVisible = !panelVisible
    if (panelVisible) {
      panelController?.reveal()
    }
    publishPanelState()
  })

  const lineageDiffReportCommand = vscode.commands.registerCommand(
    'proof-flow.lineageDiffReport',
    async (params?: unknown) => snapshotLineageDiff(parseLineageDiffInput(params))
  )

  const onEditorChange = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (!editor || !isLeanDocument(editor.document)) {
      return
    }

    await syncGoals()
  })

  const onDocumentSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (!isLeanDocument(document)) {
      return
    }

    await syncGoals()
  })

  const onDiagnosticsChange = vscode.languages.onDidChangeDiagnostics(async (event) => {
    if (!event.uris.some((uri) => isLeanUri(uri))) {
      return
    }

    await syncGoals()
  })

  context.subscriptions.push(
    togglePanel,
    lineageDiffReportCommand,
    onEditorChange,
    onDocumentSave,
    onDiagnosticsChange
  )

  const activeEditor = vscode.window.activeTextEditor
  if (activeEditor && isLeanDocument(activeEditor.document)) {
    await syncGoals()
  }
}

export async function deactivate() {
  panelController?.dispose()
  panelController = null

  if (!app) {
    return
  }

  await app.dispose()
  app = null
}
