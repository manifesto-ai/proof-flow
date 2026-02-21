import { deriveLeanState } from '../lean/derive.js'
import type {
  LeanApplyTacticOutcome,
  LeanApplyTacticParams,
  LeanContext,
  LeanRange
} from '../lean/types.js'
import {
  asRecord,
  getSnapshotData,
  type HostEffectHandler
} from './types.js'

export type CreateLeanApplyTacticEffectOptions = {
  loadContext: () => Promise<LeanContext | null>
  applyTactic: (input: LeanApplyTacticParams) => Promise<LeanApplyTacticOutcome>
  now?: () => number
}

type ApplyParams = {
  goalId: string
  tactic: string
  into: string
}

const parseInput = (params: unknown): ApplyParams | null => {
  const record = asRecord(params)
  const goalId = record?.goalId
  const tactic = record?.tactic
  const into = record?.into

  if (typeof goalId !== 'string' || goalId.length === 0) {
    return null
  }

  if (typeof tactic !== 'string' || tactic.length === 0) {
    return null
  }

  if (typeof into !== 'string' || into.length === 0) {
    return null
  }

  return { goalId, tactic, into }
}

const asRange = (value: unknown): LeanRange | null => {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const startLine = record.startLine
  const startCol = record.startCol
  const endLine = record.endLine
  const endCol = record.endCol

  if (
    typeof startLine !== 'number'
    || typeof startCol !== 'number'
    || typeof endLine !== 'number'
    || typeof endCol !== 'number'
  ) {
    return null
  }

  return {
    startLine,
    startCol,
    endLine,
    endCol
  }
}

const resolveFileUri = (snapshotData: Record<string, unknown>): string | null => {
  const host = asRecord(snapshotData.$host)
  const leanState = host ? asRecord(host.leanState) : null
  const fileUri = leanState?.fileUri
  return typeof fileUri === 'string' && fileUri.length > 0 ? fileUri : null
}

const resolveGoalRange = (
  snapshotData: Record<string, unknown>,
  goalId: string
): LeanRange | null => {
  const host = asRecord(snapshotData.$host)
  const leanState = host ? asRecord(host.leanState) : null
  const positions = leanState ? asRecord(leanState.goalPositions) : null
  return asRange(positions?.[goalId])
}

const resolveGoalKeys = (snapshotData: Record<string, unknown>): Set<string> => {
  const goals = asRecord(snapshotData.goals)
  return new Set(Object.keys(goals ?? {}))
}

export const createLeanApplyTacticEffect = (
  options: CreateLeanApplyTacticEffectOptions
): HostEffectHandler => async (params, ctx) => {
  const input = parseInput(params)
  if (!input) {
    return []
  }

  const snapshotData = getSnapshotData(ctx)
  const fileUri = resolveFileUri(snapshotData)
  const baseResult = {
    goalId: input.goalId,
    tactic: input.tactic,
    succeeded: false,
    newGoalIds: [] as string[],
    errorMessage: null as string | null
  }

  if (!fileUri) {
    return [{ op: 'set', path: input.into, value: baseResult }]
  }

  const previousGoalIds = resolveGoalKeys(snapshotData)

  try {
    const outcome = await options.applyTactic({
      fileUri,
      goalId: input.goalId,
      tactic: input.tactic,
      range: resolveGoalRange(snapshotData, input.goalId)
    })

    let hostPatch: { op: 'set'; path: '$host.leanState'; value: unknown } | null = null
    let newGoalIds: string[] = []

    const context = await options.loadContext()
    let succeeded = outcome.succeeded
    let errorMessage = outcome.errorMessage ?? null

    if (context) {
      const derived = deriveLeanState(context, options.now?.() ?? Date.now())
      hostPatch = { op: 'set', path: '$host.leanState', value: derived.hostState }
      newGoalIds = Object.keys(derived.goals).filter((goalId) => !previousGoalIds.has(goalId))

      const afterTarget = derived.goals[input.goalId]
      if (succeeded && (!afterTarget || afterTarget.status === 'open')) {
        succeeded = false
        errorMessage = errorMessage ?? 'tactic applied but proof goal unchanged'
      }
    }

    const patches: Array<{ op: 'set'; path: string; value: unknown }> = [
      {
        op: 'set',
        path: input.into,
        value: {
          goalId: input.goalId,
          tactic: input.tactic,
          succeeded,
          newGoalIds,
          errorMessage
        }
      }
    ]

    if (hostPatch) {
      patches.push(hostPatch)
    }

    return patches
  }
  catch {
    return [{ op: 'set', path: input.into, value: baseResult }]
  }
}
