export type EffectPatch =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'merge'; path: string; value: Record<string, unknown> }
  | { op: 'unset'; path: string }

export type HostEffectHandler = (
  params: unknown,
  ctx: unknown
) => Promise<readonly EffectPatch[]>

export type EffectSnapshotLike = {
  data?: Record<string, unknown>
}

export type EffectContextLike = {
  snapshot?: EffectSnapshotLike
}

export const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

export const getSnapshotData = (ctx: unknown): Record<string, unknown> => {
  const context = asRecord(ctx)
  const snapshot = context ? asRecord(context.snapshot) : null
  const data = snapshot ? asRecord(snapshot.data) : null
  return data ?? {}
}
