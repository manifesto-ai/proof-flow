import path from 'node:path'
import * as vscode from 'vscode'
import { createProofFlowRuntime, type ProofFlowDispatchSourceKind, type ProofFlowRuntime } from './runtime.js'
import { createVscodeProofFlowEffects, isLeanDocument, isLeanUri } from './effects-adapter.js'
import { ProjectionPanelController, selectProjectionState } from './webview-panel.js'

let runtime: ProofFlowRuntime | null = null
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

const ensureRuntime = async (context: vscode.ExtensionContext): Promise<ProofFlowRuntime> => {
  if (runtime) {
    return runtime
  }

  const workspace = vscode.workspace.workspaceFolders?.[0]
  if (!workspace) {
    throw new Error('ProofFlow requires an opened workspace folder.')
  }

  const schema = await readDomainMel(context)
  runtime = await createProofFlowRuntime({
    schema,
    effects: proofFlowEffects
  })

  return runtime
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

const dispatchSafely = async (
  type: string,
  input?: unknown,
  sourceKind: ProofFlowDispatchSourceKind = 'ui'
): Promise<void> => {
  if (!runtime) {
    return
  }

  try {
    await runtime.dispatch(type, input, sourceKind)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void vscode.window.showWarningMessage(`[ProofFlow] ${type} failed: ${message}`)
  }
}

export async function activate(context: vscode.ExtensionContext) {
  panelController = new ProjectionPanelController(context, {
    onSelectGoal: async (goalId) => {
      await dispatchSafely('selectGoal', { goalId }, 'ui')
    },
    onApplyTactic: async (goalId, tactic) => {
      await dispatchSafely('applyTactic', { goalId, tactic }, 'ui')
    },
    onCommitTactic: async () => {
      await dispatchSafely('commitTactic', undefined, 'ui')
    },
    onDismissTactic: async () => {
      await dispatchSafely('dismissTactic', undefined, 'ui')
    },
    onTogglePanel: async () => {
      panelVisible = !panelVisible
      if (panelVisible) {
        panelController?.reveal()
      }
      if (runtime) {
        panelController?.setState(selectProjectionState(runtime.getSnapshot(), panelVisible))
      }
    }
  })
  context.subscriptions.push(panelController)

  let readyRuntime: ProofFlowRuntime
  try {
    readyRuntime = await ensureRuntime(context)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void vscode.window.showErrorMessage(`[ProofFlow] Activation failed: ${message}`)
    return
  }

  const publishPanelState = (): void => {
    if (!runtime) {
      return
    }

    panelController?.setState(selectProjectionState(runtime.getSnapshot(), panelVisible))
  }

  const unsubscribeProjection = readyRuntime.subscribe((snapshot) => {
    panelController?.setState(selectProjectionState(snapshot, panelVisible))
  })
  context.subscriptions.push(new vscode.Disposable(unsubscribeProjection))

  publishPanelState()

  const syncGoals = async (): Promise<void> => {
    await dispatchSafely('syncGoals', undefined, 'system')
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
    async (params?: unknown) => runtime?.lineageDiffReport(parseLineageDiffInput(params).limit) ?? null
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

  runtime?.dispose()
  runtime = null
}
