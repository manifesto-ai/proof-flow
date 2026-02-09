import * as vscode from 'vscode'
import type { Range } from '@proof-flow/schema'
import {
  createProofFlowEffects,
  type LeanDiagnostic,
  type LeanDiagnosticSeverity,
  type LeanGoalHint
} from '@proof-flow/host'

export const isLeanDocument = (document: vscode.TextDocument): boolean => (
  document.languageId === 'lean'
  || document.uri.path.endsWith('.lean')
)

export const isLeanUri = (uri: vscode.Uri): boolean => uri.path.endsWith('.lean')

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
    const goals = extractGoalLines(diagnostic.message)
    for (const goal of goals) {
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

const extractGoalHintsFromDeclarations = (sourceText: string): LeanGoalHint[] => {
  const hints: LeanGoalHint[] = []
  const lines = sourceText.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    if (!/^(theorem|lemma)\b/.test(trimmed)) {
      continue
    }

    const byIndex = trimmed.indexOf(':= by')
    if (byIndex < 0) {
      continue
    }

    const head = trimmed.slice(0, byIndex)
    const goalSeparator = head.lastIndexOf(':')
    if (goalSeparator < 0) {
      continue
    }

    const goal = head.slice(goalSeparator + 1).trim()
    if (goal.length === 0) {
      continue
    }

    hints.push({
      goal,
      range: {
        startLine: index + 1,
        startCol: 0,
        endLine: index + 1,
        endCol: line.length
      },
      source: 'declaration'
    })
  }

  return hints
}

const dedupeGoalHints = (hints: readonly LeanGoalHint[]): LeanGoalHint[] => {
  const deduped: LeanGoalHint[] = []
  const seen = new Set<string>()

  for (const hint of hints) {
    const goal = hint.goal.trim()
    if (goal.length === 0) {
      continue
    }

    const range = hint.range
      ? `${hint.range.startLine}:${hint.range.startCol}:${hint.range.endLine}:${hint.range.endCol}`
      : ''
    const key = [goal, hint.source ?? '', range, hint.nodeId ?? ''].join('|')
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(hint)
  }

  return deduped
}

export const createVscodeProofFlowEffects = () => createProofFlowEffects({
  dagExtract: {
    loadContext: async ({ fileUri }) => {
      const uri = vscode.Uri.parse(fileUri)
      const document = await vscode.workspace.openTextDocument(uri)
      const diagnostics = vscode.languages.getDiagnostics(uri)
      const sourceText = document.getText()

      return {
        fileUri,
        sourceText,
        diagnostics: diagnostics.map(toLeanDiagnostic),
        goals: dedupeGoalHints([
          ...extractGoalHintsFromDiagnostics(diagnostics),
          ...extractGoalHintsFromDeclarations(sourceText)
        ])
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
