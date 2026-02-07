import * as vscode from 'vscode'
import type { App, Effects } from '@manifesto-ai/app'
import type { ProofFlowState } from '@proof-flow/schema'
import type { Range } from '@proof-flow/schema'
import {
  createProofFlowEffects,
  resolveNodeIdAtCursor,
  type LeanDiagnostic,
  type LeanDiagnosticSeverity
} from '@proof-flow/host'
import { createProofFlowApp } from './config.js'
import { createProofFlowWorld } from './worldstore.js'
import {
  ProjectionPanelController,
  selectProjectionState
} from './webview-panel.js'

let app: App | null = null
let panelController: ProjectionPanelController | null = null

const isLeanDocument = (document: vscode.TextDocument): boolean => (
  document.languageId === 'lean'
  || document.uri.path.endsWith('.lean')
)

const isLeanUri = (uri: vscode.Uri): boolean => uri.path.endsWith('.lean')

const toVscodeRange = (range: Range): vscode.Range => {
  const startLine = Math.max(range.startLine - 1, 0)
  const endLine = Math.max(range.endLine - 1, startLine)
  const startCol = Math.max(range.startCol, 0)
  const endCol = Math.max(range.endCol, startCol)
  return new vscode.Range(startLine, startCol, endLine, endCol)
}

const normalizeDiagnosticCode = (
  code: vscode.Diagnostic['code']
): string | number | undefined => {
  if (typeof code === 'string' || typeof code === 'number') {
    return code
  }

  if (code && typeof code === 'object' && 'value' in code) {
    const value = code.value
    if (typeof value === 'string' || typeof value === 'number') {
      return value
    }
  }

  return undefined
}

const toLeanSeverity = (severity: vscode.DiagnosticSeverity): LeanDiagnosticSeverity => {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error: return 'error'
    case vscode.DiagnosticSeverity.Warning: return 'warning'
    case vscode.DiagnosticSeverity.Information: return 'information'
    case vscode.DiagnosticSeverity.Hint: return 'hint'
    default: return 'information'
  }
}

const toLeanDiagnostic = (diagnostic: vscode.Diagnostic): LeanDiagnostic => ({
  message: diagnostic.message,
  severity: toLeanSeverity(diagnostic.severity),
  source: diagnostic.source,
  code: normalizeDiagnosticCode(diagnostic.code),
  range: {
    startLine: diagnostic.range.start.line + 1,
    startCol: diagnostic.range.start.character,
    endLine: diagnostic.range.end.line + 1,
    endCol: diagnostic.range.end.character
  }
})

const proofFlowEffects: Effects = createProofFlowEffects({
  dagExtract: {
    loadContext: async ({ fileUri }) => {
      const uri = vscode.Uri.parse(fileUri)
      const document = await vscode.workspace.openTextDocument(uri)
      const diagnostics = vscode.languages.getDiagnostics(uri)
      return {
        fileUri,
        sourceText: document.getText(),
        diagnostics: diagnostics.map(toLeanDiagnostic)
      }
    }
  },
  editorReveal: {
    reveal: async ({ fileUri, range }) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(fileUri))
      const editor = await vscode.window.showTextDocument(document)
      editor.revealRange(toVscodeRange(range), vscode.TextEditorRevealType.InCenter)
    }
  },
  editorGetCursor: {
    getCursor: async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        throw new Error('No active editor')
      }

      const position = editor.selection.active
      return {
        fileUri: editor.document.uri.toString(),
        position: {
          line: position.line + 1,
          column: position.character
        }
      }
    }
  }
})

const readDomainMel = async (): Promise<string> => {
  const workspace = vscode.workspace.workspaceFolders?.[0]
  if (!workspace) {
    throw new Error('ProofFlow requires an opened workspace folder.')
  }

  const domainUri = vscode.Uri.joinPath(
    workspace.uri,
    'packages',
    'schema',
    'domain.mel'
  )
  const bytes = await vscode.workspace.fs.readFile(domainUri)
  return new TextDecoder().decode(bytes)
}

const ensureApp = async (): Promise<App> => {
  if (app) {
    return app
  }

  const workspace = vscode.workspace.workspaceFolders?.[0]
  if (!workspace) {
    throw new Error('ProofFlow requires an opened workspace folder.')
  }

  const schema = await readDomainMel()
  const world = await createProofFlowWorld({
    world: {
      rootPath: workspace.uri.fsPath
    }
  })

  app = createProofFlowApp({
    schema,
    effects: proofFlowEffects,
    world
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

export async function activate(context: vscode.ExtensionContext) {
  let readyApp: App

  panelController = new ProjectionPanelController(context, {
    onNodeSelect: async (nodeId) => {
      await actSafely('node_select', { nodeId })
    },
    onTogglePanel: async () => {
      await actSafely('panel_toggle')
    },
    onSetLayout: async (layout) => {
      await actSafely('layout_set', { layout })
    },
    onSetZoom: async (zoom) => {
      await actSafely('zoom_set', { zoom })
    },
    onToggleCollapse: async () => {
      await actSafely('collapse_toggle')
    }
  })

  context.subscriptions.push(panelController)

  try {
    readyApp = await ensureApp()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void vscode.window.showErrorMessage(`[ProofFlow] Activation failed: ${message}`)
    return
  }

  const unsubscribeProjection = readyApp.subscribe(
    (state) => selectProjectionState(state),
    (projection) => {
      panelController?.setState(projection)
    }
  )
  context.subscriptions.push(new vscode.Disposable(unsubscribeProjection))

  const togglePanel = vscode.commands.registerCommand('proof-flow.hello', async () => {
    const visible = app?.getState<ProofFlowState>().data.ui.panelVisible ?? false

    if (visible && !panelController?.isOpen()) {
      panelController?.reveal()
      return
    }

    await actSafely('panel_toggle')

    const nextVisible = app?.getState<ProofFlowState>().data.ui.panelVisible ?? false
    if (nextVisible) {
      panelController?.reveal()
    }
  })

  const onEditorChange = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (!editor || !isLeanDocument(editor.document)) {
      return
    }

    const fileUri = editor.document.uri.toString()
    await actSafely('file_activate', { fileUri })
    await actSafely('dag_sync', { fileUri })
  })

  const onDocumentSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (!isLeanDocument(document)) {
      return
    }

    await actSafely('dag_sync', {
      fileUri: document.uri.toString()
    })
  })

  const onDiagnosticsChange = vscode.languages.onDidChangeDiagnostics(async (event) => {
    const leanUris = event.uris.filter((uri) => isLeanUri(uri))
    for (const uri of leanUris) {
      await actSafely('dag_sync', { fileUri: uri.toString() })
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
    onEditorChange,
    onDocumentSave,
    onDiagnosticsChange,
    onSelectionChange
  )

  const activeEditor = vscode.window.activeTextEditor
  if (activeEditor && isLeanDocument(activeEditor.document)) {
    const fileUri = activeEditor.document.uri.toString()
    await actSafely('file_activate', {
      fileUri
    })
    await actSafely('dag_sync', {
      fileUri
    })
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
