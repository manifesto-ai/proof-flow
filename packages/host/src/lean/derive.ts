import type { Goal, GoalStatus } from '@proof-flow/schema'
import { classifyLeanErrorCategory } from './error-category.js'
import type {
  LeanContext,
  LeanDagNode,
  LeanDagNodeKind,
  LeanDagNodeStatus,
  LeanDerivedState,
  LeanDiagnostic,
  LeanHostState,
  LeanRange
} from './types.js'

type Declaration = {
  startLine: number
  endLine: number
  kind: LeanDagNodeKind
  label: string
  statement: string | null
  proof: boolean
}

const normalizeRange = (range: LeanRange): LeanRange => ({
  startLine: Math.max(1, Math.floor(range.startLine)),
  startCol: Math.max(0, Math.floor(range.startCol)),
  endLine: Math.max(1, Math.floor(range.endLine)),
  endCol: Math.max(0, Math.floor(range.endCol))
})

const stableHash = (input: string): string => {
  let hash = 5381
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index)
  }

  return Math.abs(hash).toString(16)
}

const normalizeGoalStatement = (statement: string): string => (
  statement
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
)

const toGoalId = (startLine: number, statement: string): string => (
  `goal:${startLine}:${stableHash(normalizeGoalStatement(statement))}`
)

const toDiagnosticGoalId = (line: number, message: string): string => `diag:${line}:${stableHash(message)}`

const parseDeclarationLine = (line: string): Omit<Declaration, 'startLine' | 'endLine'> | null => {
  const trimmed = line.trim()
  const match = /^(theorem|lemma|example|def)\b/.exec(trimmed)
  if (!match) {
    return null
  }

  const keyword = match[1] as 'theorem' | 'lemma' | 'example' | 'def'
  const kind: LeanDagNodeKind = keyword === 'def' ? 'definition' : keyword
  const label = trimmed.split(':=', 1)[0]?.trim() ?? trimmed

  if (keyword === 'def') {
    return {
      kind,
      label,
      statement: null,
      proof: false
    }
  }

  const byIndex = trimmed.indexOf(':= by')
  if (byIndex < 0) {
    return {
      kind,
      label,
      statement: null,
      proof: true
    }
  }

  const header = trimmed.slice(0, byIndex)
  const colon = header.lastIndexOf(':')
  const statement = colon >= 0
    ? header.slice(colon + 1).trim()
    : header

  return {
    kind,
    label,
    statement: statement.length > 0 ? statement : null,
    proof: true
  }
}

const extractDeclarations = (sourceText: string): Declaration[] => {
  const lines = sourceText.split(/\r?\n/)
  const starts: Array<Declaration> = []

  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseDeclarationLine(lines[index] ?? '')
    if (!parsed) {
      continue
    }

    starts.push({
      startLine: index + 1,
      endLine: index + 1,
      ...parsed
    })
  }

  for (let index = 0; index < starts.length; index += 1) {
    const current = starts[index]
    if (!current) {
      continue
    }

    const next = starts[index + 1]
    current.endLine = next ? Math.max(current.startLine, next.startLine - 1) : lines.length
  }

  return starts
}

const hasLineBetween = (line: number, startLine: number, endLine: number): boolean => (
  line >= startLine && line <= endLine
)

const goalStatusToNodeStatus = (status: GoalStatus): LeanDagNodeStatus => {
  if (status === 'failed') {
    return 'error'
  }

  if (status === 'open') {
    return 'sorry'
  }

  return 'resolved'
}

const normalizeMessage = (message: string): string => {
  const singleLine = message.split(/\r?\n/, 1)[0] ?? message
  return singleLine.trim() || 'diagnostic'
}

const parseSorryRange = (lineText: string, lineNumber: number): LeanRange | null => {
  const col = lineText.indexOf('sorry')
  if (col < 0) {
    return null
  }

  return {
    startLine: lineNumber,
    startCol: col,
    endLine: lineNumber,
    endCol: col + 'sorry'.length
  }
}

const deriveGoalsAndDag = (
  context: LeanContext,
  now: number
): LeanDerivedState => {
  const lines = context.sourceText.split(/\r?\n/)
  const declarations = extractDeclarations(context.sourceText)
  const diagnostics = context.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    range: normalizeRange(diagnostic.range)
  }))

  const goals: Record<string, Goal> = {}
  const goalPositions: Record<string, LeanRange> = {}
  const nodes: Record<string, LeanDagNode> = {}
  const edges: Array<{ source: string; target: string }> = []

  const rootId = 'root'
  nodes[rootId] = {
    nodeId: rootId,
    label: context.fileUri,
    kind: 'definition',
    startLine: 1,
    endLine: Math.max(lines.length, 1),
    parentId: null,
    status: 'in_progress',
    errorMessage: null,
    errorCategory: null,
    goalId: null
  }

  const coveredDiagnostics = new Set<number>()

  for (const declaration of declarations) {
    const nodeId = `decl:${declaration.startLine}`
    const blockLines = lines.slice(Math.max(0, declaration.startLine - 1), declaration.endLine)

    const blockDiagnostics = diagnostics
      .map((diagnostic, index) => ({ diagnostic, index }))
      .filter(({ diagnostic }) => hasLineBetween(diagnostic.range.startLine, declaration.startLine, declaration.endLine))

    for (const item of blockDiagnostics) {
      coveredDiagnostics.add(item.index)
    }

    const firstError = blockDiagnostics.find(({ diagnostic }) => diagnostic.severity === 'error')?.diagnostic ?? null
    const firstSorry = blockLines
      .map((line, offset) => parseSorryRange(line ?? '', declaration.startLine + offset))
      .find((range): range is LeanRange => range !== null) ?? null

    let goalId: string | null = null
    let status: GoalStatus = 'resolved'

    if (declaration.proof) {
      const statement = declaration.statement ?? declaration.label
      goalId = toGoalId(declaration.startLine, statement)

      if (firstError) {
        status = 'failed'
      }
      else if (firstSorry) {
        status = 'open'
      }

      goals[goalId] = {
        id: goalId,
        statement,
        status
      }

      goalPositions[goalId] = firstSorry ?? {
        startLine: declaration.startLine,
        startCol: 0,
        endLine: declaration.startLine,
        endCol: Math.max((lines[declaration.startLine - 1] ?? '').length, 1)
      }
    }

    nodes[nodeId] = {
      nodeId,
      label: declaration.label,
      kind: declaration.kind,
      startLine: declaration.startLine,
      endLine: declaration.endLine,
      parentId: rootId,
      status: declaration.proof
        ? goalStatusToNodeStatus(status)
        : (firstError ? 'error' : 'resolved'),
      errorMessage: firstError ? normalizeMessage(firstError.message) : null,
      errorCategory: firstError ? classifyLeanErrorCategory(firstError.message) : null,
      goalId
    }

    edges.push({ source: rootId, target: nodeId })
  }

  for (let index = 0; index < diagnostics.length; index += 1) {
    if (coveredDiagnostics.has(index)) {
      continue
    }

    const diagnostic = diagnostics[index]
    if (!diagnostic || diagnostic.severity !== 'error') {
      continue
    }

    const message = normalizeMessage(diagnostic.message)
    const goalId = toDiagnosticGoalId(diagnostic.range.startLine, message)
    goals[goalId] = {
      id: goalId,
      statement: message,
      status: 'failed'
    }
    goalPositions[goalId] = diagnostic.range

    const nodeId = `diag:${diagnostic.range.startLine}:${index}`
    nodes[nodeId] = {
      nodeId,
      label: message,
      kind: 'diagnostic',
      startLine: diagnostic.range.startLine,
      endLine: diagnostic.range.endLine,
      parentId: rootId,
      status: 'error',
      errorMessage: message,
      errorCategory: classifyLeanErrorCategory(diagnostic.message),
      goalId
    }
    edges.push({ source: rootId, target: nodeId })
  }

  const hasError = Object.values(nodes).some((node) => node.status === 'error')
  const hasSorry = Object.values(nodes).some((node) => node.status === 'sorry')

  nodes[rootId] = {
    ...nodes[rootId],
    status: hasError ? 'error' : (hasSorry ? 'in_progress' : 'resolved')
  }

  const hostState: LeanHostState = {
    fileUri: context.fileUri,
    dag: { nodes, edges },
    goalPositions,
    diagnostics,
    lastElaboratedAt: now
  }

  return { goals, hostState }
}

export const deriveLeanState = (
  context: LeanContext,
  now: number = Date.now()
): LeanDerivedState => deriveGoalsAndDag(context, now)
