import type { ProofDAG, Range } from '@proof-flow/schema'
import {
  asRecord,
  getSnapshotData,
  type HostEffectHandler
} from './types.js'

export type EditorRevealInput = {
  fileUri: string
  nodeId: string
}

export type RevealRangeInput = {
  fileUri: string
  range: Range
}

export type EditorRevealHandler = (input: RevealRangeInput) => Promise<void>

export type CreateEditorRevealEffectOptions = {
  reveal: EditorRevealHandler
}

const parseInput = (params: unknown): EditorRevealInput | null => {
  const record = asRecord(params)
  const fileUri = record?.fileUri
  const nodeId = record?.nodeId

  if (typeof fileUri !== 'string' || typeof nodeId !== 'string') {
    return null
  }

  return { fileUri, nodeId }
}

const isRange = (value: unknown): value is Range => {
  const range = asRecord(value)
  return !!range
    && typeof range.startLine === 'number'
    && typeof range.startCol === 'number'
    && typeof range.endLine === 'number'
    && typeof range.endCol === 'number'
}

const getDag = (snapshotData: Record<string, unknown>, fileUri: string): ProofDAG | null => {
  const files = asRecord(snapshotData.files)
  const fileState = files ? asRecord(files[fileUri]) : null
  const dag = fileState ? asRecord(fileState.dag) : null
  return dag as ProofDAG | null
}

const resolveRange = (
  snapshotData: Record<string, unknown>,
  fileUri: string,
  nodeId: string
): Range | null => {
  const dag = getDag(snapshotData, fileUri)
  const nodes = dag ? asRecord(dag.nodes) : null
  const node = nodes ? asRecord(nodes[nodeId]) : null
  const range = node ? node.leanRange : null
  return isRange(range) ? range : null
}

export const createEditorRevealEffect = (
  options: CreateEditorRevealEffectOptions
): HostEffectHandler => async (params, ctx) => {
  const input = parseInput(params)
  if (!input) {
    return []
  }

  const snapshotData = getSnapshotData(ctx)
  const range = resolveRange(snapshotData, input.fileUri, input.nodeId)
  if (!range) {
    return []
  }

  try {
    await options.reveal({ fileUri: input.fileUri, range })
  }
  catch {
    // Side-effect failure is intentionally swallowed.
  }

  return []
}
