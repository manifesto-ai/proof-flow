import type {
  ErrorCategory,
  NodeKind,
  ProofDAG,
  ProofNode,
  Range,
  StatusKind
} from '@proof-flow/schema'
import { classifyLeanErrorCategory } from './error-category.js'
import type { LeanContext, LeanDiagnostic, ParsedDiagnosticNode } from './types.js'

export type ParseLeanDagOptions = {
  now?: () => number
}

const DECLARATION_PATTERNS: ReadonlyArray<{ pattern: RegExp; kind: NodeKind }> = [
  { pattern: /\btheorem\b/i, kind: 'theorem' },
  { pattern: /\blemma\b/i, kind: 'lemma' },
  { pattern: /\bhave\b/i, kind: 'have' },
  { pattern: /\blet\b/i, kind: 'let' },
  { pattern: /\bsuffices\b/i, kind: 'suffices' },
  { pattern: /\bshow\b/i, kind: 'show' },
  { pattern: /\bcase\b/i, kind: 'case' },
  { pattern: /\bcalc\b/i, kind: 'calc_step' },
  { pattern: /\bsorry\b/i, kind: 'sorry' }
]

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
)

const normalizeRange = (range: Range): Range => {
  const startLine = isFiniteNumber(range.startLine) ? Math.max(Math.floor(range.startLine), 1) : 1
  const endLineRaw = isFiniteNumber(range.endLine) ? Math.max(Math.floor(range.endLine), startLine) : startLine

  const startColRaw = isFiniteNumber(range.startCol) ? Math.max(Math.floor(range.startCol), 0) : 0
  const endColRaw = isFiniteNumber(range.endCol) ? Math.max(Math.floor(range.endCol), 0) : startColRaw

  const endCol = endLineRaw === startLine ? Math.max(endColRaw, startColRaw) : endColRaw

  return {
    startLine,
    startCol: startColRaw,
    endLine: endLineRaw,
    endCol
  }
}

const compareRange = (left: Range, right: Range): number => {
  if (left.startLine !== right.startLine)
    return left.startLine - right.startLine

  if (left.startCol !== right.startCol)
    return left.startCol - right.startCol

  if (left.endLine !== right.endLine)
    return left.endLine - right.endLine

  return left.endCol - right.endCol
}

const getSeverityRank = (severity?: string): number => {
  switch (severity) {
    case 'error': return 0
    case 'warning': return 1
    case 'information': return 2
    case 'hint': return 3
    default: return 4
  }
}

const sortDiagnostics = (diagnostics: readonly LeanDiagnostic[]): LeanDiagnostic[] => (
  [...diagnostics].sort((left, right) => {
    const leftRange = normalizeRange(left.range)
    const rightRange = normalizeRange(right.range)
    const rangeOrder = compareRange(leftRange, rightRange)
    if (rangeOrder !== 0)
      return rangeOrder

    const severityOrder = getSeverityRank(left.severity) - getSeverityRank(right.severity)
    if (severityOrder !== 0)
      return severityOrder

    return left.message.localeCompare(right.message)
  })
)

const normalizeMessage = (message: string): string => {
  const firstLine = message.split(/\r?\n/, 1)[0] ?? message
  return firstLine.trim().slice(0, 120) || 'diagnostic'
}

const inferKind = (message: string): NodeKind => {
  for (const entry of DECLARATION_PATTERNS) {
    if (entry.pattern.test(message)) {
      return entry.kind
    }
  }

  return 'tactic_block'
}

const inferStatus = (diagnostic: LeanDiagnostic): {
  kind: StatusKind
  errorCategory: ErrorCategory | null
  errorMessage: string | null
} => {
  const message = diagnostic.message
  if (/\bsorry\b/i.test(message)) {
    return {
      kind: 'sorry',
      errorCategory: 'OTHER',
      errorMessage: message
    }
  }

  if (diagnostic.severity === 'error') {
    return {
      kind: 'error',
      errorCategory: classifyLeanErrorCategory(message),
      errorMessage: message
    }
  }

  return {
    kind: diagnostic.severity === 'warning' ? 'in_progress' : 'resolved',
    errorCategory: null,
    errorMessage: null
  }
}

const buildFileRange = (
  sourceText: string,
  diagnostics: readonly LeanDiagnostic[]
): Range | null => {
  const lines = sourceText.split(/\r?\n/)
  if (sourceText.trim().length > 0 || lines.length > 1 || (lines[0] ?? '').length > 0) {
    const lastLine = lines[lines.length - 1] ?? ''
    return {
      startLine: 1,
      startCol: 0,
      endLine: Math.max(lines.length, 1),
      endCol: lastLine.length
    }
  }

  if (diagnostics.length === 0) {
    return null
  }

  return diagnostics
    .map((item) => normalizeRange(item.range))
    .reduce((acc, range) => ({
      startLine: Math.min(acc.startLine, range.startLine),
      startCol: acc.startLine < range.startLine ? acc.startCol : Math.min(acc.startCol, range.startCol),
      endLine: Math.max(acc.endLine, range.endLine),
      endCol: acc.endLine > range.endLine ? acc.endCol : Math.max(acc.endCol, range.endCol)
    }))
}

const buildDiagnosticNode = (
  diagnostic: LeanDiagnostic,
  index: number
): ParsedDiagnosticNode => {
  const status = inferStatus(diagnostic)
  return {
    id: `diag:${index}`,
    label: normalizeMessage(diagnostic.message),
    range: normalizeRange(diagnostic.range),
    statusKind: status.kind,
    errorCategory: status.errorCategory,
    errorMessage: status.errorMessage
  }
}

const countStatus = (nodes: Record<string, ProofNode>, kind: StatusKind): number => (
  Object.values(nodes).filter((node) => node.status.kind === kind).length
)

const inferRootKind = (sourceText: string): NodeKind => {
  const head = sourceText
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)

  if (!head) {
    return 'theorem'
  }

  return inferKind(head)
}

export const parseLeanContextToProofDag = (
  context: LeanContext,
  options: ParseLeanDagOptions = {}
): ProofDAG => {
  const now = options.now ?? Date.now
  const sorted = sortDiagnostics(context.diagnostics)
  const parsedDiagnostics = sorted.map((diagnostic, index) => buildDiagnosticNode(diagnostic, index))
  const fileRange = buildFileRange(context.sourceText, sorted)

  if (!fileRange) {
    return {
      fileUri: context.fileUri,
      rootIds: [],
      nodes: {},
      extractedAt: now(),
      metrics: {
        totalNodes: 0,
        resolvedCount: 0,
        errorCount: 0,
        sorryCount: 0,
        inProgressCount: 0,
        maxDepth: 0
      }
    }
  }

  const children = parsedDiagnostics.map((node) => node.id)
  const rootNode: ProofNode = {
    id: 'root',
    kind: inferRootKind(context.sourceText),
    label: context.sourceText
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)?.trim()
      ?.slice(0, 120) ?? 'proof',
    leanRange: fileRange,
    goal: null,
    status: {
      kind: parsedDiagnostics.length === 0 ? 'resolved' : 'in_progress',
      errorMessage: null,
      errorCategory: null
    },
    children,
    dependencies: []
  }

  const nodes: Record<string, ProofNode> = { root: rootNode }
  for (const item of parsedDiagnostics) {
    nodes[item.id] = {
      id: item.id,
      kind: inferKind(item.label),
      label: item.label,
      leanRange: item.range,
      goal: null,
      status: {
        kind: item.statusKind,
        errorMessage: item.errorMessage,
        errorCategory: item.errorCategory
      },
      children: [],
      dependencies: []
    }
  }

  return {
    fileUri: context.fileUri,
    rootIds: ['root'],
    nodes,
    extractedAt: now(),
    metrics: {
      totalNodes: Object.keys(nodes).length,
      resolvedCount: countStatus(nodes, 'resolved'),
      errorCount: countStatus(nodes, 'error'),
      sorryCount: countStatus(nodes, 'sorry'),
      inProgressCount: countStatus(nodes, 'in_progress'),
      maxDepth: parsedDiagnostics.length === 0 ? 0 : 1
    }
  }
}
