import {
  createIntent,
  createManifesto,
  dispatchAsync,
  type EffectHandler,
  type Snapshot
} from '@manifesto-ai/sdk'
import {
  createHumanActor,
  createIntentInstance,
  createManifestoWorld,
  createMemoryWorldStore,
  type HostExecutor,
  type SourceKind,
  type World,
  type WorldId
} from '@manifesto-ai/world'
import type { ProofFlowState, TacticResult } from '@proof-flow/schema'

type ProofFlowSnapshotData = ProofFlowState & Record<string, unknown>

export type ProofFlowRuntimeSnapshot = Snapshot<ProofFlowSnapshotData>

export type ProofFlowDispatchSourceKind = Extract<SourceKind, 'system' | 'ui'>

export type ProofFlowRuntimeOptions = {
  schema: string
  effects: Record<string, EffectHandler>
}

export type GoalLite = {
  id: string
  status: string
  statement: string
}

export type LineageDiffEntry = {
  fromWorldId: string
  toWorldId: string
  fromCreatedAt: number | null
  toCreatedAt: number | null
  counts: {
    added: number
    removed: number
    statusChanged: number
  }
  addedGoals: GoalLite[]
  removedGoals: GoalLite[]
  statusChanges: Array<{
    id: string
    fromStatus: string
    toStatus: string
    statement: string
  }>
  fromTacticResult: TacticResult | null
  toTacticResult: TacticResult | null
}

export type LineageDiffReport = {
  measuredAt: string
  branch: {
    branchId: 'main'
    branchName: 'main'
    headWorldId: string | null
    lineageLength: number
  }
  summary: {
    edges: number
    added: number
    removed: number
    statusChanged: number
  }
  worldIds: string[]
  diffs: LineageDiffEntry[]
}

export type ProofFlowRuntime = {
  getSnapshot: () => ProofFlowRuntimeSnapshot
  subscribe: (listener: (snapshot: ProofFlowRuntimeSnapshot) => void) => () => void
  dispatch: (
    type: string,
    input?: unknown,
    sourceKind?: ProofFlowDispatchSourceKind
  ) => Promise<ProofFlowRuntimeSnapshot>
  lineageDiffReport: (limit: number) => Promise<LineageDiffReport>
  dispose: () => void
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const asNullableNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
)

const asString = (value: unknown): string | null => (
  typeof value === 'string' && value.length > 0 ? value : null
)

const asNullableString = (value: unknown): string | null => (
  typeof value === 'string' ? value : null
)

const extractStateData = (snapshot: unknown): Record<string, unknown> | null => {
  const snapshotRecord = asRecord(snapshot)
  if (!snapshotRecord) {
    return null
  }

  if (asRecord(snapshotRecord.goals)) {
    return snapshotRecord
  }

  const nested = asRecord(snapshotRecord.data)
  if (nested && asRecord(nested.goals)) {
    return nested
  }

  return null
}

const extractGoals = (stateData: Record<string, unknown> | null): Map<string, GoalLite> => {
  const goals = asRecord(stateData?.goals)
  const result = new Map<string, GoalLite>()

  if (!goals) {
    return result
  }

  for (const [goalId, entry] of Object.entries(goals)) {
    const goal = asRecord(entry)
    const id = asString(goal?.id) ?? goalId
    const statement = asString(goal?.statement)
    const status = asString(goal?.status)

    if (!id || !statement || !status) {
      continue
    }

    result.set(id, {
      id,
      status,
      statement
    })
  }

  return result
}

const normalizeTacticResult = (stateData: Record<string, unknown> | null): TacticResult | null => {
  const value = asRecord(stateData?.tacticResult)
  if (!value) {
    return null
  }

  const goalId = asString(value.goalId)
  const tactic = asString(value.tactic)
  const succeeded = value.succeeded
  const newGoalIds = value.newGoalIds
  const errorMessage = asNullableString(value.errorMessage)

  if (!goalId || !tactic || typeof succeeded !== 'boolean' || !Array.isArray(newGoalIds)) {
    return null
  }

  return {
    goalId,
    tactic,
    succeeded,
    newGoalIds: newGoalIds.filter((entry): entry is string => typeof entry === 'string'),
    errorMessage
  }
}

const diffGoals = (
  fromGoals: Map<string, GoalLite>,
  toGoals: Map<string, GoalLite>
): Omit<LineageDiffEntry, 'fromWorldId' | 'toWorldId' | 'fromCreatedAt' | 'toCreatedAt' | 'fromTacticResult' | 'toTacticResult'> => {
  const addedGoals: GoalLite[] = []
  const removedGoals: GoalLite[] = []
  const statusChanges: Array<{ id: string; fromStatus: string; toStatus: string; statement: string }> = []

  for (const [id, goal] of toGoals.entries()) {
    if (!fromGoals.has(id)) {
      addedGoals.push(goal)
    }
  }

  for (const [id, goal] of fromGoals.entries()) {
    if (!toGoals.has(id)) {
      removedGoals.push(goal)
      continue
    }

    const nextGoal = toGoals.get(id)
    if (nextGoal && nextGoal.status !== goal.status) {
      statusChanges.push({
        id,
        fromStatus: goal.status,
        toStatus: nextGoal.status,
        statement: nextGoal.statement
      })
    }
  }

  addedGoals.sort((left, right) => left.id.localeCompare(right.id))
  removedGoals.sort((left, right) => left.id.localeCompare(right.id))
  statusChanges.sort((left, right) => left.id.localeCompare(right.id))

  return {
    counts: {
      added: addedGoals.length,
      removed: removedGoals.length,
      statusChanged: statusChanges.length
    },
    addedGoals,
    removedGoals,
    statusChanges
  }
}

const createExecutor = (
  schema: string,
  effects: Record<string, EffectHandler>
): HostExecutor => ({
  async execute(_key, baseSnapshot, intent) {
    const manifesto = createManifesto<ProofFlowSnapshotData>({
      schema,
      effects,
      snapshot: baseSnapshot as ProofFlowRuntimeSnapshot
    })

    try {
      const terminalSnapshot = await dispatchAsync(manifesto, intent)
      return {
        outcome: 'completed',
        terminalSnapshot
      }
    }
    catch {
      return {
        outcome: 'failed',
        terminalSnapshot: manifesto.getSnapshot()
      }
    }
    finally {
      manifesto.dispose()
    }
  }
})

const buildIntent = (type: string, input: unknown, intentId: string) => (
  input === undefined
    ? createIntent(type, intentId)
    : createIntent(type, input, intentId)
)

const buildOrderedWorldIds = (currentWorldId: WorldId, worldIds: WorldId[]): WorldId[] => {
  if (worldIds.length === 0) {
    return [currentWorldId]
  }

  const deduped = [...new Set(worldIds)]
  const lastWorldId = deduped[deduped.length - 1]
  return lastWorldId === currentWorldId
    ? deduped
    : [...deduped, currentWorldId]
}

export const createProofFlowRuntime = async (
  options: ProofFlowRuntimeOptions
): Promise<ProofFlowRuntime> => {
  const bootstrap = createManifesto<ProofFlowSnapshotData>({
    schema: options.schema,
    effects: options.effects
  })
  const initialSnapshot = bootstrap.getSnapshot()
  const schemaHash = initialSnapshot.meta.schemaHash
  bootstrap.dispose()

  const actor = createHumanActor('proof-flow:local-user', 'ProofFlow Local User')
  const world = createManifestoWorld({
    schemaHash,
    executor: createExecutor(options.schema, options.effects),
    store: createMemoryWorldStore()
  })
  world.registerActor(actor, { mode: 'auto_approve' })

  const genesis = await world.createGenesis(initialSnapshot)
  let currentWorldId = genesis.worldId
  let currentSnapshot = initialSnapshot
  let disposed = false
  let dispatchSequence = 0

  const listeners = new Set<(snapshot: ProofFlowRuntimeSnapshot) => void>()

  const notify = (): void => {
    for (const listener of listeners) {
      listener(currentSnapshot)
    }
  }

  return {
    getSnapshot: () => currentSnapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispatch: async (type, input, sourceKind = 'ui') => {
      if (disposed) {
        throw new Error('ProofFlow runtime is disposed')
      }

      dispatchSequence += 1
      const intentId = `proof-flow-intent-${dispatchSequence}`
      const intent = buildIntent(type, input, intentId)
      const body = input === undefined ? { type } : { type, input }
      const intentInstance = await createIntentInstance({
        body,
        schemaHash,
        projectionId: 'proof-flow',
        source: {
          kind: sourceKind,
          eventId: intentId
        },
        actor,
        intentId
      })

      const result = await world.submitProposal(actor.actorId, intentInstance, currentWorldId)
      if (result.resultWorld) {
        currentWorldId = result.resultWorld.worldId
        const nextSnapshot = await world.getSnapshot(currentWorldId)
        if (nextSnapshot) {
          currentSnapshot = nextSnapshot as ProofFlowRuntimeSnapshot
        }
      }

      notify()
      return currentSnapshot
    },
    lineageDiffReport: async (limit) => {
      const lineage = world.getLineage()
      const orderedWorldIds = buildOrderedWorldIds(
        currentWorldId,
        lineage.getAncestors(currentWorldId).reverse().map((entry) => entry.worldId)
      ).slice(-Math.max(2, limit))

      const entries = await Promise.all(orderedWorldIds.map(async (worldId) => {
        const worldEntry = await world.getWorld(worldId)
        const snapshot = await world.getSnapshot(worldId)

        return {
          worldId,
          createdAt: asNullableNumber(asRecord(worldEntry)?.createdAt),
          stateData: extractStateData(snapshot)
        }
      }))

      const diffs: LineageDiffEntry[] = []
      for (let index = 1; index < entries.length; index += 1) {
        const fromEntry = entries[index - 1]
        const toEntry = entries[index]

        if (!fromEntry || !toEntry) {
          continue
        }

        diffs.push({
          fromWorldId: fromEntry.worldId,
          toWorldId: toEntry.worldId,
          fromCreatedAt: fromEntry.createdAt,
          toCreatedAt: toEntry.createdAt,
          ...diffGoals(
            extractGoals(fromEntry.stateData),
            extractGoals(toEntry.stateData)
          ),
          fromTacticResult: normalizeTacticResult(fromEntry.stateData),
          toTacticResult: normalizeTacticResult(toEntry.stateData)
        })
      }

      const summary = diffs.reduce((acc, entry) => ({
        edges: acc.edges + 1,
        added: acc.added + entry.counts.added,
        removed: acc.removed + entry.counts.removed,
        statusChanged: acc.statusChanged + entry.counts.statusChanged
      }), {
        edges: 0,
        added: 0,
        removed: 0,
        statusChanged: 0
      })

      return {
        measuredAt: new Date().toISOString(),
        branch: {
          branchId: 'main' as const,
          branchName: 'main' as const,
          headWorldId: currentWorldId,
          lineageLength: entries.length
        },
        summary,
        worldIds: entries.map((entry) => String(entry.worldId)),
        diffs
      }
    },
    dispose: () => {
      disposed = true
      listeners.clear()
    }
  }
}
