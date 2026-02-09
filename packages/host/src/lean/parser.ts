import type {
  ErrorCategory,
  NodeKind,
  ProofDAG,
  ProofNode,
  Range,
  StatusKind
} from '@proof-flow/schema'
import { classifyLeanErrorCategory } from './error-category.js'
import type {
  LeanContext,
  LeanDiagnostic,
  LeanGoalHint
} from './types.js'

export type ParseLeanDagOptions = {
  now?: () => number
}

const DECLARATION_PATTERNS: ReadonlyArray<{ pattern: RegExp; kind: NodeKind }> = [
  { pattern: /\bdef\b/i, kind: 'tactic_block' },
  { pattern: /\bexample\b/i, kind: 'theorem' },
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

const LINE_NODE_PATTERNS: ReadonlyArray<{ pattern: RegExp; kind: NodeKind }> = [
  { pattern: /^(?:private\s+|protected\s+)?theorem\b/i, kind: 'theorem' },
  { pattern: /^(?:private\s+|protected\s+)?lemma\b/i, kind: 'lemma' },
  { pattern: /^(?:private\s+|protected\s+)?example\b/i, kind: 'theorem' },
  { pattern: /^(?:private\s+|protected\s+)?def\b/i, kind: 'tactic_block' },
  { pattern: /^have\b/i, kind: 'have' },
  { pattern: /^let\b/i, kind: 'let' },
  { pattern: /^suffices\b/i, kind: 'suffices' },
  { pattern: /^show\b/i, kind: 'show' },
  { pattern: /^case\b/i, kind: 'case' },
  { pattern: /^calc\b/i, kind: 'calc_step' },
  { pattern: /^sorry\b/i, kind: 'sorry' }
]

type MutableNode = ProofNode & {
  indent: number
  explicitSorry: boolean
}

type SourceCandidate = {
  id: string
  kind: NodeKind
  label: string
  indent: number
  startLine: number
  startCol: number
  explicitSorry: boolean
}

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

const rangeArea = (range: Range): number => {
  const lineSpan = Math.max(range.endLine - range.startLine + 1, 1)
  const colSpan = lineSpan === 1
    ? Math.max(range.endCol - range.startCol + 1, 1)
    : Math.max(range.endCol + 1, 1)
  return lineSpan * 100_000 + colSpan
}

const containsRange = (container: Range, target: Range): boolean => {
  if (container.startLine > target.startLine || container.endLine < target.endLine) {
    return false
  }

  if (container.startLine === target.startLine && container.startCol > target.startCol) {
    return false
  }

  if (container.endLine === target.endLine && container.endCol < target.endCol) {
    return false
  }

  return true
}

const overlapsRange = (left: Range, right: Range): boolean => {
  const comparePosition = (
    lineA: number,
    colA: number,
    lineB: number,
    colB: number
  ): number => {
    if (lineA !== lineB) {
      return lineA - lineB
    }
    return colA - colB
  }

  return !(
    comparePosition(left.endLine, left.endCol, right.startLine, right.startCol) < 0
    || comparePosition(right.endLine, right.endCol, left.startLine, left.startCol) < 0
  )
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

const stripLineComment = (line: string): string => {
  const marker = line.indexOf('--')
  if (marker < 0) {
    return line
  }
  return line.slice(0, marker)
}

const leadingIndent = (line: string): number => {
  let width = 0
  for (const char of line) {
    if (char === ' ') {
      width += 1
      continue
    }
    if (char === '\t') {
      width += 2
      continue
    }
    break
  }
  return width
}

const lineLengthAt = (lines: readonly string[], lineNumber: number): number => {
  const line = lines[Math.max(0, lineNumber - 1)]
  return line ? line.length : 0
}

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

const inferRootKind = (sourceText: string): NodeKind => {
  const head = sourceText
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)

  if (!head) {
    return 'theorem'
  }

  return inferKind(head)
}

const normalizeGoal = (goal: string): string | null => {
  const normalized = goal
    .replace(/\r\n/g, '\n')
    .trim()

  if (normalized.length === 0) {
    return null
  }

  return normalized
}

const extractSourceCandidates = (sourceText: string): SourceCandidate[] => {
  const lines = sourceText.split(/\r?\n/)
  const candidates: SourceCandidate[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? ''
    const lineWithoutComment = stripLineComment(rawLine)
    const trimmed = lineWithoutComment.trim()
    if (trimmed.length === 0) {
      continue
    }

    let kind: NodeKind | null = null
    for (const pattern of LINE_NODE_PATTERNS) {
      if (pattern.pattern.test(trimmed)) {
        kind = pattern.kind
        break
      }
    }

    if (!kind) {
      continue
    }

    const startCol = lineWithoutComment.search(/\S/)
    const safeStartCol = startCol >= 0 ? startCol : 0
    const lineNo = index + 1
    candidates.push({
      id: `src:${lineNo}:${safeStartCol}:${kind}`,
      kind,
      label: trimmed.slice(0, 120),
      indent: leadingIndent(rawLine),
      startLine: lineNo,
      startCol: safeStartCol,
      explicitSorry: /\bsorry\b/i.test(trimmed)
    })
  }

  return candidates
}

const makeRootNode = (
  sourceText: string,
  fileRange: Range
): MutableNode => ({
  id: 'root',
  kind: inferRootKind(sourceText),
  label: sourceText
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)?.trim()
    ?.slice(0, 120) ?? 'proof',
  leanRange: fileRange,
  goalCurrent: null,
  goalSnapshots: [],
  estimatedDistance: null,
  status: {
    kind: 'resolved',
    errorMessage: null,
    errorCategory: null
  },
  children: [],
  dependencies: [],
  indent: -1,
  explicitSorry: false
})

const buildNodesFromSource = (
  sourceText: string,
  fileRange: Range
): Record<string, MutableNode> => {
  const lines = sourceText.split(/\r?\n/)
  const nodes: Record<string, MutableNode> = {
    root: makeRootNode(sourceText, fileRange)
  }
  const candidates = extractSourceCandidates(sourceText)
  const stack: string[] = ['root']
  const lastLine = Math.max(lines.length, 1)

  const closeNodeAt = (nodeId: string, nextStartLine: number, nextStartCol: number): void => {
    const node = nodes[nodeId]
    if (!node || nodeId === 'root') {
      return
    }

    if (nextStartLine <= node.leanRange.startLine) {
      node.leanRange.endLine = node.leanRange.startLine
      node.leanRange.endCol = Math.max(node.leanRange.startCol, nextStartCol)
      return
    }

    const endLine = Math.max(node.leanRange.startLine, Math.min(nextStartLine - 1, lastLine))
    node.leanRange.endLine = endLine
    node.leanRange.endCol = lineLengthAt(lines, endLine)
  }

  for (const candidate of candidates) {
    while (stack.length > 1) {
      const topId = stack[stack.length - 1]
      if (!topId) {
        break
      }
      const topNode = nodes[topId]
      if (!topNode || candidate.indent > topNode.indent) {
        break
      }
      closeNodeAt(topId, candidate.startLine, candidate.startCol)
      stack.pop()
    }

    const parentId = stack[stack.length - 1] ?? 'root'
    const parentNode = nodes[parentId] ?? nodes.root
    const node: MutableNode = {
      id: candidate.id,
      kind: candidate.kind,
      label: candidate.label,
      leanRange: {
        startLine: candidate.startLine,
        startCol: candidate.startCol,
        endLine: candidate.startLine,
        endCol: lineLengthAt(lines, candidate.startLine)
      },
      goalCurrent: null,
      goalSnapshots: [],
      estimatedDistance: null,
      status: candidate.explicitSorry
        ? {
            kind: 'sorry',
            errorCategory: 'OTHER',
            errorMessage: candidate.label
          }
        : {
            kind: 'resolved',
            errorCategory: null,
            errorMessage: null
          },
      children: [],
      dependencies: [parentNode.id],
      indent: candidate.indent,
      explicitSorry: candidate.explicitSorry
    }
    nodes[node.id] = node
    parentNode.children.push(node.id)
    stack.push(node.id)
  }

  while (stack.length > 1) {
    const nodeId = stack.pop()
    if (!nodeId) {
      break
    }
    closeNodeAt(nodeId, lastLine + 1, 0)
  }

  return nodes
}

const statusRank = (status: StatusKind): number => {
  switch (status) {
    case 'error': return 4
    case 'sorry': return 3
    case 'in_progress': return 2
    case 'resolved': return 1
    default: return 0
  }
}

const applyStatus = (
  node: MutableNode,
  incoming: {
    kind: StatusKind
    errorCategory: ErrorCategory | null
    errorMessage: string | null
  }
): void => {
  if (statusRank(incoming.kind) <= statusRank(node.status.kind)) {
    return
  }

  node.status = {
    kind: incoming.kind,
    errorCategory: incoming.errorCategory,
    errorMessage: incoming.errorMessage
  }
}

const findBestNodeForRange = (
  nodes: Record<string, MutableNode>,
  range: Range
): MutableNode | null => {
  const nonRoot = Object.values(nodes).filter((node) => node.id !== 'root')

  const containing = nonRoot
    .filter((node) => containsRange(node.leanRange, range))
    .sort((left, right) => {
      const areaOrder = rangeArea(left.leanRange) - rangeArea(right.leanRange)
      if (areaOrder !== 0) {
        return areaOrder
      }
      return compareRange(left.leanRange, right.leanRange)
    })
  if (containing.length > 0) {
    return containing[0] ?? null
  }

  const overlapping = nonRoot
    .filter((node) => overlapsRange(node.leanRange, range))
    .sort((left, right) => compareRange(left.leanRange, right.leanRange))
  if (overlapping.length > 0) {
    return overlapping[0] ?? null
  }

  return null
}

const applyDiagnostics = (
  nodes: Record<string, MutableNode>,
  diagnostics: readonly LeanDiagnostic[]
): void => {
  const root = nodes.root
  if (!root) {
    return
  }

  for (let index = 0; index < diagnostics.length; index += 1) {
    const diagnostic = diagnostics[index]
    if (!diagnostic) {
      continue
    }
    const range = normalizeRange(diagnostic.range)
    const status = inferStatus(diagnostic)
    const target = findBestNodeForRange(nodes, range)
    if (target) {
      applyStatus(target, status)
    }

    const diagId = `diag:${index}`
    const dependencyId = target?.id ?? 'root'
    nodes[diagId] = {
      id: diagId,
      kind: inferKind(diagnostic.message),
      label: normalizeMessage(diagnostic.message),
      leanRange: range,
      goalCurrent: null,
      goalSnapshots: [],
      estimatedDistance: null,
      status: {
        kind: status.kind,
        errorCategory: status.errorCategory,
        errorMessage: status.errorMessage
      },
      children: [],
      dependencies: [dependencyId],
      indent: 0,
      explicitSorry: status.kind === 'sorry'
    }
    const parent = nodes[dependencyId] ?? root
    parent.children.push(diagId)
  }
}

const propagateParentStatuses = (nodes: Record<string, MutableNode>): void => {
  const ordered = Object.values(nodes)
    .sort((left, right) => {
      const areaOrder = rangeArea(right.leanRange) - rangeArea(left.leanRange)
      if (areaOrder !== 0) {
        return areaOrder
      }
      return compareRange(right.leanRange, left.leanRange)
    })

  for (const node of ordered) {
    if (node.status.kind !== 'resolved') {
      continue
    }
    if (node.children.length === 0) {
      continue
    }
    const hasUnresolvedChild = node.children.some((childId) => {
      const child = nodes[childId]
      return child ? child.status.kind !== 'resolved' : false
    })
    if (hasUnresolvedChild) {
      node.status = {
        kind: 'in_progress',
        errorCategory: null,
        errorMessage: null
      }
    }
  }
}

const stripInternalFields = (nodes: Record<string, MutableNode>): Record<string, ProofNode> => (
  Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [
      id,
      {
        id: node.id,
        kind: node.kind,
        label: node.label,
        leanRange: node.leanRange,
        goalCurrent: node.goalCurrent ?? null,
        goalSnapshots: Array.isArray(node.goalSnapshots) ? [...node.goalSnapshots] : [],
        estimatedDistance: node.estimatedDistance ?? null,
        status: node.status,
        children: [...node.children],
        dependencies: [...node.dependencies]
      } satisfies ProofNode
    ])
  )
)

const resolveGoalTargetNodeId = (
  hint: LeanGoalHint,
  nodes: Record<string, ProofNode>
): string => {
  const nodeId = hint.nodeId
  if (typeof nodeId === 'string' && nodeId.length > 0 && nodes[nodeId]) {
    return nodeId
  }

  if (!hint.range) {
    return 'root'
  }

  const goalRange = normalizeRange(hint.range)
  const allNodes = Object.values(nodes)

  const containing = allNodes
    .filter((node) => containsRange(node.leanRange, goalRange))
    .sort((left, right) => {
      const areaOrder = rangeArea(left.leanRange) - rangeArea(right.leanRange)
      if (areaOrder !== 0) {
        return areaOrder
      }
      return left.id.localeCompare(right.id)
    })

  if (containing.length > 0) {
    return containing[0]!.id
  }

  const overlapping = allNodes
    .filter((node) => overlapsRange(node.leanRange, goalRange))
    .sort((left, right) => compareRange(left.leanRange, right.leanRange))

  if (overlapping.length > 0) {
    return overlapping[0]!.id
  }

  return 'root'
}

const applyGoalHints = (
  nodes: Record<string, ProofNode>,
  hints: readonly LeanGoalHint[]
): void => {
  for (const hint of hints) {
    const goal = normalizeGoal(hint.goal)
    if (!goal) {
      continue
    }

    const targetNodeId = resolveGoalTargetNodeId(hint, nodes)
    const targetNode = nodes[targetNodeId]
    if (!targetNode) {
      continue
    }

    if (targetNode.goalCurrent === null || typeof targetNode.goalCurrent === 'undefined') {
      targetNode.goalCurrent = goal
    }
  }
}

const estimateNodeDistance = (
  node: ProofNode,
  nodes: Record<string, ProofNode>
): number | null => {
  if (node.status.kind === 'resolved') {
    return 0
  }

  const unresolvedChildren = node.children
    .map((childId) => nodes[childId])
    .filter((child): child is ProofNode => Boolean(child))
    .filter((child) => child.status.kind !== 'resolved')
    .length

  return Math.max(1, unresolvedChildren + 1)
}

const withEstimatedDistances = (nodes: Record<string, ProofNode>): void => {
  for (const node of Object.values(nodes)) {
    node.estimatedDistance = estimateNodeDistance(node, nodes)
  }
}

const computeProgress = (nodes: Record<string, ProofNode>): {
  totalGoals: number
  resolvedGoals: number
  blockedGoals: number
  sorryGoals: number
  estimatedRemaining: number | null
} => {
  const goalNodes = Object.values(nodes).filter((node) => (
    node.id !== 'root'
    && !node.id.startsWith('diag:')
  ))

  const totalGoals = goalNodes.length
  const resolvedGoals = goalNodes.filter((node) => node.status.kind === 'resolved').length
  const blockedGoals = goalNodes.filter((node) => node.status.kind === 'error').length
  const sorryGoals = goalNodes.filter((node) => node.status.kind === 'sorry').length
  const unresolved = goalNodes.filter((node) => node.status.kind !== 'resolved')
  const estimatedRemaining = unresolved.length > 0
    ? unresolved.reduce((sum, node) => sum + (node.estimatedDistance ?? 1), 0)
    : 0

  return {
    totalGoals,
    resolvedGoals,
    blockedGoals,
    sorryGoals,
    estimatedRemaining
  }
}

export const parseLeanContextToProofDag = (
  context: LeanContext,
  options: ParseLeanDagOptions = {}
): ProofDAG => {
  const now = options.now ?? Date.now
  const sorted = sortDiagnostics(context.diagnostics)
  const fileRange = buildFileRange(context.sourceText, sorted)

  if (!fileRange) {
    return {
      fileUri: context.fileUri,
      rootIds: [],
      nodes: {},
      extractedAt: now(),
      progress: {
        totalGoals: 0,
        resolvedGoals: 0,
        blockedGoals: 0,
        sorryGoals: 0,
        estimatedRemaining: 0
      }
    }
  }

  const mutableNodes = buildNodesFromSource(context.sourceText, fileRange)
  applyDiagnostics(mutableNodes, sorted)
  propagateParentStatuses(mutableNodes)
  const nodes = stripInternalFields(mutableNodes)
  applyGoalHints(nodes, context.goals ?? [])
  withEstimatedDistances(nodes)
  const rootIds = ['root']

  return {
    fileUri: context.fileUri,
    rootIds,
    nodes,
    extractedAt: now(),
    progress: computeProgress(nodes)
  }
}
