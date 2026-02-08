import type { ProofDAG } from '@proof-flow/schema'
import {
  asRecord,
  getSnapshotData,
  type HostEffectHandler,
  type EffectPatch
} from './types.js'
import type { LeanContext, LeanGoalHint } from '../lean/types.js'
import { parseLeanContextToProofDag } from '../lean/parser.js'
import { validateProofDag } from '../schemas/proof-dag.js'

export type DagExtractInput = {
  fileUri: string
}

export type DagExtractHandler = (input: DagExtractInput) => Promise<unknown>
export type DagExtractContextLoader = (input: DagExtractInput) => Promise<LeanContext>
export type DagExtractGoalsLoader = (
  input: DagExtractInput,
  context: LeanContext
) => Promise<readonly LeanGoalHint[] | null | undefined>

export type CreateDagExtractEffectOptions = {
  extractDag?: DagExtractHandler
  loadContext?: DagExtractContextLoader
  loadGoals?: DagExtractGoalsLoader
  now?: () => number
}

type FileStateLike = {
  fileUri: string
  dag: ProofDAG | null
  lastSyncedAt: number | null
  [key: string]: unknown
}

const parseInput = (params: unknown): DagExtractInput | null => {
  const record = asRecord(params)
  const fileUri = record?.fileUri
  return typeof fileUri === 'string' ? { fileUri } : null
}

const getPreviousFileState = (
  snapshotData: Record<string, unknown>,
  fileUri: string
): FileStateLike => {
  const files = asRecord(snapshotData.files)
  const previous = files ? asRecord(files[fileUri]) : null

  return {
    fileUri,
    dag: null,
    lastSyncedAt: null,
    ...(previous ?? {})
  }
}

const buildMergePatch = (fileUri: string, fileState: FileStateLike): EffectPatch => ({
  op: 'merge',
  path: 'files',
  value: {
    [fileUri]: fileState
  }
})

const toProofDagOrNull = (candidate: unknown): ProofDAG | null => {
  if (candidate == null) {
    return null
  }

  return validateProofDag(candidate)
}

const resolveProofDag = async (
  options: CreateDagExtractEffectOptions,
  input: DagExtractInput,
  syncedAt: number
): Promise<ProofDAG | null> => {
  if (options.extractDag) {
    const candidate = await options.extractDag(input)
    return toProofDagOrNull(candidate)
  }

  if (!options.loadContext) {
    return null
  }

  const baseContext = await options.loadContext(input)
  const extraGoals = options.loadGoals
    ? await options.loadGoals(input, baseContext)
    : null
  const context: LeanContext = {
    ...baseContext,
    goals: [
      ...(baseContext.goals ?? []),
      ...(extraGoals ?? [])
    ]
  }
  const candidate = parseLeanContextToProofDag(context, { now: () => syncedAt })
  return toProofDagOrNull(candidate)
}

export const createDagExtractEffect = (
  options: CreateDagExtractEffectOptions
): HostEffectHandler => async (params, ctx) => {
  const input = parseInput(params)
  if (!input) {
    return []
  }

  const fileUri = input.fileUri
  const syncedAt = options.now?.() ?? Date.now()
  const snapshotData = getSnapshotData(ctx)
  const previous = getPreviousFileState(snapshotData, fileUri)

  try {
    const dag = await resolveProofDag(options, input, syncedAt)
    return [buildMergePatch(fileUri, {
      ...previous,
      fileUri,
      dag,
      lastSyncedAt: syncedAt
    })]
  }
  catch {
    return [buildMergePatch(fileUri, {
      ...previous,
      fileUri,
      dag: null,
      lastSyncedAt: syncedAt
    })]
  }
}
