import * as vscode from 'vscode'
import {
  createProofFlowEffects,
  type LeanApplyTacticOutcome,
  type LeanContext,
  type LeanDiagnostic,
  type LeanDiagnosticSeverity,
  type LeanRange
} from '@proof-flow/host'

export const isLeanDocument = (document: vscode.TextDocument): boolean => (
  document.languageId === 'lean'
  || document.uri.path.endsWith('.lean')
)

export const isLeanUri = (uri: vscode.Uri): boolean => uri.path.endsWith('.lean')

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

const getActiveLeanEditor = (): vscode.TextEditor | null => {
  const editor = vscode.window.activeTextEditor
  if (!editor || !isLeanDocument(editor.document)) {
    return null
  }

  return editor
}

const loadActiveLeanContext = async (): Promise<LeanContext | null> => {
  const editor = getActiveLeanEditor()
  if (!editor) {
    return null
  }

  const uri = editor.document.uri
  const diagnostics = vscode.languages.getDiagnostics(uri)

  return {
    fileUri: uri.toString(),
    sourceText: editor.document.getText(),
    diagnostics: diagnostics.map(toLeanDiagnostic)
  }
}

const toVscodeRange = (range: LeanRange): vscode.Range => new vscode.Range(
  Math.max(0, range.startLine - 1),
  Math.max(0, range.startCol),
  Math.max(0, range.endLine - 1),
  Math.max(0, range.endCol)
)

const locateSorryRange = (
  document: vscode.TextDocument,
  hintRange: LeanRange | null
): vscode.Range | null => {
  const lines = document.getText().split(/\r?\n/)

  if (hintRange) {
    const lineIndex = Math.max(0, hintRange.startLine - 1)
    const line = lines[lineIndex] ?? ''
    const sorryIndex = line.indexOf('sorry')
    if (sorryIndex >= 0) {
      return new vscode.Range(lineIndex, sorryIndex, lineIndex, sorryIndex + 'sorry'.length)
    }

    return toVscodeRange(hintRange)
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? ''
    const sorryIndex = line.indexOf('sorry')
    if (sorryIndex >= 0) {
      return new vscode.Range(lineIndex, sorryIndex, lineIndex, sorryIndex + 'sorry'.length)
    }
  }

  return null
}

const waitForDiagnosticsQuiet = (uri: vscode.Uri, stableMs = 180, timeoutMs = 1200): Promise<void> => new Promise((resolve) => {
  let settled = false
  let quietTimer: ReturnType<typeof setTimeout> | null = null
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null

  const finish = () => {
    if (settled) {
      return
    }

    settled = true
    if (quietTimer) {
      clearTimeout(quietTimer)
      quietTimer = null
    }
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
    subscription.dispose()
    resolve()
  }

  const resetQuietTimer = () => {
    if (quietTimer) {
      clearTimeout(quietTimer)
    }
    quietTimer = setTimeout(() => finish(), stableMs)
  }

  const subscription = vscode.languages.onDidChangeDiagnostics((event) => {
    if (event.uris.some((candidate) => candidate.toString() === uri.toString())) {
      resetQuietTimer()
    }
  })

  timeoutTimer = setTimeout(() => finish(), timeoutMs)
  resetQuietTimer()
})

const applyTacticAtGoal = async (input: {
  fileUri: string
  tactic: string
  range: LeanRange | null
}): Promise<LeanApplyTacticOutcome> => {
  try {
    const uri = vscode.Uri.parse(input.fileUri)
    const document = await vscode.workspace.openTextDocument(uri)
    const targetRange = locateSorryRange(document, input.range)
    if (!targetRange) {
      return {
        succeeded: false,
        errorMessage: 'TARGET_NOT_FOUND'
      }
    }

    const edit = new vscode.WorkspaceEdit()
    edit.replace(uri, targetRange, input.tactic)
    const applied = await vscode.workspace.applyEdit(edit)
    if (!applied) {
      return {
        succeeded: false,
        errorMessage: 'EDIT_REJECTED'
      }
    }

    await waitForDiagnosticsQuiet(uri)
    return { succeeded: true }
  }
  catch (error) {
    return {
      succeeded: false,
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}

export const createVscodeProofFlowEffects = () => createProofFlowEffects({
  syncGoals: {
    loadContext: loadActiveLeanContext
  },
  applyTactic: {
    loadContext: loadActiveLeanContext,
    applyTactic: async ({ fileUri, tactic, range }) => applyTacticAtGoal({
      fileUri,
      tactic,
      range
    })
  }
})
