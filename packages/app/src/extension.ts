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
