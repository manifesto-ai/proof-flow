import * as vscode from 'vscode'
import type { App, Effects } from '@manifesto-ai/app'
import type {
  AttemptResult,
  ProofFlowState,
  Range,
  StatusKind
} from '@proof-flow/schema'
import {
  createProofFlowEffects,
  resolveNodeIdAtCursor,
  type LeanDiagnostic,
  type LeanGoalHint,
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
const attemptFingerprints = new Map<string, string>()

const isLeanDocument = (document: vscode.TextDocument): boolean => (
  document.languageId === 'lean'
  || document.uri.path.endsWith('.lean')
)

const isLeanUri = (uri: vscode.Uri): boolean => uri.path.endsWith('.lean')

const LEAN_GOAL_COMMAND_CANDIDATES = [
  'lean4.infoview.api.getGoals',
  'lean4.infoview.getGoals',
  'lean4.getGoals',
  'lean4.goalState',
  'lean4.goals'
] as const

type GoalSourceStats = {
  diagnosticHints: number
  hoverHints: number
  commandHints: number
  commandsUsed: string[]
}

const goalSourceStatsByFileUri = new Map<string, GoalSourceStats>()

let cachedGoalCommands: string[] | undefined

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

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const asRange = (value: unknown): Range | null => {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  // Native Lean-style payload shape
  if (
    typeof record.startLine === 'number'
    && typeof record.startCol === 'number'
    && typeof record.endLine === 'number'
    && typeof record.endCol === 'number'
  ) {
    return {
      startLine: record.startLine,
      startCol: record.startCol,
      endLine: record.endLine,
      endCol: record.endCol
    }
  }

  // VS Code range shape
  const start = asRecord(record.start)
  const end = asRecord(record.end)
  if (
    start
    && end
    && typeof start.line === 'number'
    && typeof start.character === 'number'
    && typeof end.line === 'number'
    && typeof end.character === 'number'
  ) {
    return {
      startLine: start.line + 1,
      startCol: start.character,
      endLine: end.line + 1,
      endCol: end.character
    }
  }

  return null
}

const extractGoalLines = (message: string): string[] => message
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.includes('⊢') || line.toLowerCase().startsWith('goal:'))
  .map((line) => line.startsWith('goal:') ? line.slice(5).trim() : line)
  .filter((line) => line.length > 0)

const extractGoalHintsFromDiagnostics = (
  diagnostics: readonly vscode.Diagnostic[]
): LeanGoalHint[] => {
  const hints: LeanGoalHint[] = []
  for (const diagnostic of diagnostics) {
    const lines = extractGoalLines(diagnostic.message)
    for (const goal of lines) {
      hints.push({
        goal,
        range: {
          startLine: diagnostic.range.start.line + 1,
          startCol: diagnostic.range.start.character,
          endLine: diagnostic.range.end.line + 1,
          endCol: diagnostic.range.end.character
        },
        source: 'diagnostic'
      })
    }
  }

  return hints
}

const toHoverContentText = (content: vscode.MarkedString | vscode.MarkdownString): string => {
  if (typeof content === 'string') {
    return content
  }

  if ('value' in content && typeof content.value === 'string') {
    return content.value
  }

  const contentRecord = content as { value?: unknown }
  return typeof contentRecord.value === 'string' ? contentRecord.value : ''
}

const extractGoalHintsFromHoverProvider = async (
  uri: vscode.Uri,
  diagnostics: readonly vscode.Diagnostic[]
): Promise<LeanGoalHint[]> => {
  const commandsApi = vscode.commands as typeof vscode.commands & {
    executeCommand?: (command: string, ...args: unknown[]) => Thenable<unknown>
  }

  if (typeof commandsApi.executeCommand !== 'function') {
    return []
  }

  const hints: LeanGoalHint[] = []
  const seen = new Set<string>()

  for (const diagnostic of diagnostics.slice(0, 20)) {
    try {
      const position = new vscode.Position(
        diagnostic.range.start.line,
        diagnostic.range.start.character
      )
      const raw = await commandsApi.executeCommand(
        'vscode.executeHoverProvider',
        uri,
        position
      )
      const hovers = Array.isArray(raw) ? raw as vscode.Hover[] : []

      for (const hover of hovers) {
        const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents]
        for (const content of contents) {
          const text = toHoverContentText(content)
          const goals = extractGoalLines(text)
          for (const goal of goals) {
            const key = [
              goal,
              diagnostic.range.start.line,
              diagnostic.range.start.character,
              diagnostic.range.end.line,
              diagnostic.range.end.character
            ].join('|')
            if (seen.has(key)) {
              continue
            }

            seen.add(key)
            hints.push({
              goal,
              range: {
                startLine: diagnostic.range.start.line + 1,
                startCol: diagnostic.range.start.character,
                endLine: diagnostic.range.end.line + 1,
                endCol: diagnostic.range.end.character
              },
              source: 'hover'
            })
          }
        }
      }
    }
    catch {
      // Ignore per-position hover failures and continue with other hints.
    }
  }

  return hints
}

const normalizeGoalHints = (raw: unknown, source: string): LeanGoalHint[] => {
  const list = Array.isArray(raw)
    ? raw
    : (asRecord(raw)?.goals as unknown[] | undefined)

  if (!Array.isArray(list)) {
    return []
  }

  const hints: LeanGoalHint[] = []
  for (const item of list) {
    if (typeof item === 'string') {
      const goal = item.trim()
      if (goal.length > 0) {
        hints.push({ goal, source })
      }
      continue
    }

    const record = asRecord(item)
    if (!record) {
      continue
    }

    const goalCandidate = (
      typeof record.goal === 'string' ? record.goal
      : typeof record.type === 'string' ? record.type
      : typeof record.goalText === 'string' ? record.goalText
      : null
    )
    if (!goalCandidate || goalCandidate.trim().length === 0) {
      continue
    }

    const range = asRange(record.range)
    const nodeId = typeof record.nodeId === 'string' ? record.nodeId : undefined

    hints.push({
      goal: goalCandidate.trim(),
      range,
      nodeId,
      source
    })
  }

  return hints
}

const discoverLeanGoalCommands = async (): Promise<string[]> => {
  if (cachedGoalCommands) {
    return cachedGoalCommands
  }

  const commandsApi = vscode.commands as typeof vscode.commands & {
    getCommands?: (filterInternal?: boolean) => Thenable<string[]>
  }

  if (typeof commandsApi.getCommands !== 'function') {
    cachedGoalCommands = []
    return cachedGoalCommands
  }

  try {
    const all = await commandsApi.getCommands(true)
    const discovered = all.filter((command) => (
      command.startsWith('lean4.')
      && /(goal|infoview)/i.test(command)
      && /(get|fetch|request|state|goals)/i.test(command)
    ))

    const merged = [...LEAN_GOAL_COMMAND_CANDIDATES, ...discovered]
    const unique: string[] = []
    for (const command of merged) {
      if (!all.includes(command)) {
        continue
      }
      if (!unique.includes(command)) {
        unique.push(command)
      }
    }

    cachedGoalCommands = unique
    return cachedGoalCommands
  }
  catch {
    cachedGoalCommands = []
    return cachedGoalCommands
  }
}

const buildGoalCommandArgs = (
  fileUri: string,
  diagnostics: readonly vscode.Diagnostic[]
): unknown[][] => {
  const uri = vscode.Uri.parse(fileUri)
  const first = diagnostics[0]
  const line = first?.range.start.line ?? 0
  const character = first?.range.start.character ?? 0

  return [
    [{ fileUri }],
    [{ uri: fileUri }],
    [fileUri],
    [uri],
    [{ fileUri, position: { line: line + 1, column: character } }],
    [{ uri: fileUri, position: { line: line + 1, column: character } }],
    [uri, new vscode.Position(line, character)],
    [uri, { line, character }],
    []
  ]
}

const loadGoalHintsFromLeanCommands = async (
  fileUri: string,
  diagnostics: readonly vscode.Diagnostic[]
): Promise<{ hints: LeanGoalHint[]; commandsUsed: string[] }> => {
  const commands = await discoverLeanGoalCommands()
  if (commands.length === 0) {
    return { hints: [], commandsUsed: [] }
  }

  const execute = vscode.commands.executeCommand as unknown as (command: string, ...args: unknown[]) => Promise<unknown>
  const hints: LeanGoalHint[] = []
  const commandsUsed: string[] = []
  const argsCandidates = buildGoalCommandArgs(fileUri, diagnostics)
  const maxCommands = 4

  for (const command of commands.slice(0, maxCommands)) {
    let commandMatched = false
    for (const args of argsCandidates) {
      try {
        const payload = await execute(command, ...args)
        const normalized = normalizeGoalHints(payload, `command:${command}`)
        if (normalized.length === 0) {
          continue
        }

        hints.push(...normalized)
        commandMatched = true
        break
      }
      catch {
        // Ignore signature mismatch and continue probing next call shape.
      }
    }

    if (commandMatched) {
      commandsUsed.push(command)
    }
  }

  return { hints, commandsUsed }
}

const proofFlowEffects: Effects = createProofFlowEffects({
  dagExtract: {
    loadContext: async ({ fileUri }) => {
      const uri = vscode.Uri.parse(fileUri)
      const document = await vscode.workspace.openTextDocument(uri)
      const diagnostics = vscode.languages.getDiagnostics(uri)
      return {
        fileUri,
        sourceText: document.getText(),
        diagnostics: diagnostics.map(toLeanDiagnostic),
        goals: extractGoalHintsFromDiagnostics(diagnostics)
      }
    },
    loadGoals: async ({ fileUri }, context) => {
      const uri = vscode.Uri.parse(fileUri)
      const diagnostics = vscode.languages.getDiagnostics(uri)
      const diagnosticHints = context.goals ?? extractGoalHintsFromDiagnostics(diagnostics)
      const hoverHints = await extractGoalHintsFromHoverProvider(uri, diagnostics)
      const commandResult = await loadGoalHintsFromLeanCommands(fileUri, diagnostics)
      const merged = [
        ...diagnosticHints,
        ...hoverHints,
        ...commandResult.hints
      ]

      goalSourceStatsByFileUri.set(fileUri, {
        diagnosticHints: diagnosticHints.length,
        hoverHints: hoverHints.length,
        commandHints: commandResult.hints.length,
        commandsUsed: commandResult.commandsUsed
      })

      return merged
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

const toAttemptResult = (status: StatusKind): AttemptResult => {
  switch (status) {
    case 'resolved': return 'success'
    case 'error': return 'error'
    case 'sorry': return 'placeholder'
    default: return 'placeholder'
  }
}

const maybeRecordAttempt = async (targetFileUri: string): Promise<void> => {
  if (!app) {
    return
  }

  const state = app.getState<ProofFlowState>().data
  const file = state.files[targetFileUri]
  const dag = file?.dag
  if (!dag) {
    return
  }

  const nodeId = state.ui.cursorNodeId ?? state.ui.selectedNodeId
  if (!nodeId) {
    return
  }

  const node = dag.nodes[nodeId]
  if (!node || node.status.kind === 'in_progress') {
    return
  }

  const fingerprint = [
    node.status.kind,
    node.status.errorCategory ?? '',
    node.status.errorMessage ?? ''
  ].join('|')
  const key = `${targetFileUri}:${nodeId}`
  if (attemptFingerprints.get(key) === fingerprint) {
    return
  }

  attemptFingerprints.set(key, fingerprint)
  await actSafely('attempt_record', {
    fileUri: targetFileUri,
    nodeId,
    tactic: `auto:${node.kind}`,
    tacticKey: node.kind,
    result: toAttemptResult(node.status.kind),
    contextErrorCategory: node.status.errorCategory,
    errorMessage: node.status.errorMessage,
    durationMs: null
  })
}

const reportGoalCoverage = async (): Promise<void> => {
  if (!app) {
    return
  }

  const state = app.getState<ProofFlowState>().data
  const activeFileUri = state.ui.activeFileUri
  if (!activeFileUri) {
    void vscode.window.showInformationMessage('[ProofFlow] No active Lean file for goal coverage.')
    return
  }

  const dag = state.files[activeFileUri]?.dag
  if (!dag) {
    void vscode.window.showInformationMessage('[ProofFlow] No DAG available for active file.')
    return
  }

  const nodes = Object.values(dag.nodes)
  const totalNodes = nodes.length
  const withGoal = nodes.filter((node) => typeof node.goal === 'string' && node.goal.trim().length > 0).length
  const ratio = totalNodes > 0 ? withGoal / totalNodes : 0
  const percent = (ratio * 100).toFixed(1)
  const stats = goalSourceStatsByFileUri.get(activeFileUri)
  const sourceSummary = stats
    ? ` | hints d/h/c=${stats.diagnosticHints}/${stats.hoverHints}/${stats.commandHints}`
      + (stats.commandsUsed.length > 0 ? ` | cmds=${stats.commandsUsed.join(',')}` : '')
    : ''
  const message = `[ProofFlow] Goal coverage ${withGoal}/${totalNodes} (${percent}%)${sourceSummary}`
  void vscode.window.showInformationMessage(message)
}

export async function activate(context: vscode.ExtensionContext) {
  let readyApp: App

  const resetPatterns = async (): Promise<void> => {
    attemptFingerprints.clear()
    await actSafely('patterns_reset')
  }

  const suggestTacticsForCurrentNode = async (): Promise<void> => {
    if (!app) {
      return
    }

    const state = app.getState<ProofFlowState>().data
    const fileUri = state.ui.activeFileUri
    const nodeId = state.ui.selectedNodeId ?? state.ui.cursorNodeId
    if (!fileUri || !nodeId) {
      void vscode.window.showInformationMessage('[ProofFlow] Select a node before requesting suggestions.')
      return
    }

    await actSafely('attempt_suggest', { fileUri, nodeId })
  }

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
    },
    onResetPatterns: async () => {
      await resetPatterns()
    },
    onSuggestTactics: async () => {
      await suggestTacticsForCurrentNode()
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

  const resetPatternsCommand = vscode.commands.registerCommand('proof-flow.patternsReset', async () => {
    await resetPatterns()
  })

  const suggestTacticsCommand = vscode.commands.registerCommand('proof-flow.suggestTactics', async () => {
    await suggestTacticsForCurrentNode()
  })

  const goalCoverageReportCommand = vscode.commands.registerCommand('proof-flow.goalCoverageReport', async () => {
    await reportGoalCoverage()
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

    const fileUri = document.uri.toString()
    await actSafely('dag_sync', { fileUri })
    await maybeRecordAttempt(fileUri)
  })

  const onDiagnosticsChange = vscode.languages.onDidChangeDiagnostics(async (event) => {
    const leanUris = event.uris.filter((uri) => isLeanUri(uri))
    for (const uri of leanUris) {
      const fileUri = uri.toString()
      await actSafely('dag_sync', { fileUri })
      await maybeRecordAttempt(fileUri)
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
    resetPatternsCommand,
    suggestTacticsCommand,
    goalCoverageReportCommand,
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
    attemptFingerprints.clear()
    goalSourceStatsByFileUri.clear()
    cachedGoalCommands = undefined
    return
  }

  await app.dispose()
  app = null
  attemptFingerprints.clear()
  goalSourceStatsByFileUri.clear()
  cachedGoalCommands = undefined
}
