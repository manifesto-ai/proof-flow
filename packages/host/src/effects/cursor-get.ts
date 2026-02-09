import type { ProofDAG, Range } from '@proof-flow/schema'
import {
  asRecord,
  getSnapshotData,
  type HostEffectHandler,
  type EffectPatch
} from './types.js'

export type CursorPosition = {
  line: number
  column: number
}

export type EditorCursor = {
  fileUri: string
  position: CursorPosition
}

export type EditorGetCursorHandler = () => Promise<EditorCursor>

export type ResolveCursorNodeId = (dag: ProofDAG, cursor: EditorCursor) => string | null

export type CreateEditorGetCursorEffectOptions = {
  getCursor: EditorGetCursorHandler
  resolveNodeId?: ResolveCursorNodeId
}

const getDag = (snapshotData: Record<string, unknown>, fileUri: string): ProofDAG | null => {
  const files = asRecord(snapshotData.files)
  const fileState = files ? asRecord(files[fileUri]) : null
  const dag = fileState ? asRecord(fileState.dag) : null
  return dag as ProofDAG | null
}

const isRange = (value: unknown): value is Range => {
  const range = asRecord(value)
  return !!range
    && typeof range.startLine === 'number'
    && typeof range.startCol === 'number'
    && typeof range.endLine === 'number'
    && typeof range.endCol === 'number'
}

const contains = (range: Range, position: CursorPosition): boolean => {
  if (position.line < range.startLine || position.line > range.endLine) {
    return false
  }

  if (position.line === range.startLine && position.column < range.startCol) {
    return false
  }

  if (position.line === range.endLine && position.column > range.endCol) {
    return false
  }

  return true
}

const span = (range: Range): number => {
  const lineSpan = (range.endLine - range.startLine) * 100_000
  const colSpan = range.endCol - range.startCol
  return lineSpan + colSpan
}

export const resolveNodeIdAtCursor: ResolveCursorNodeId = (dag, cursor) => {
  const nodes = asRecord(dag.nodes)
  if (!nodes) {
    return null
  }

  let selected: { id: string; span: number } | null = null
  for (const [id, nodeValue] of Object.entries(nodes)) {
    const node = asRecord(nodeValue)
    const range = node ? node.leanRange : null
    if (!isRange(range) || !contains(range, cursor.position)) {
      continue
    }

    const size = span(range)
    if (!selected || size < selected.span) {
      selected = { id, span: size }
    }
  }

  return selected?.id ?? null
}

const setCursorNodePatch = (nodeId: string | null): EffectPatch => ({
  op: 'set',
  path: 'cursorNodeId',
  value: nodeId
})

export const createEditorGetCursorEffect = (
  options: CreateEditorGetCursorEffectOptions
): HostEffectHandler => async (_, ctx) => {
  try {
    const cursor = await options.getCursor()
    const snapshotData = getSnapshotData(ctx)
    const dag = getDag(snapshotData, cursor.fileUri)
    if (!dag) {
      return [setCursorNodePatch(null)]
    }

    const resolveNodeId = options.resolveNodeId ?? resolveNodeIdAtCursor
    return [setCursorNodePatch(resolveNodeId(dag, cursor))]
  }
  catch {
    return [setCursorNodePatch(null)]
  }
}
