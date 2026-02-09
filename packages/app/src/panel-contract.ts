import type { ProjectionState } from './projection-state.js'

export type PanelToExtensionMessage =
  | { type: 'selectGoal'; payload: { goalId: string | null } }
  | { type: 'applyTactic'; payload: { goalId: string; tactic: string } }
  | { type: 'commitTactic' }
  | { type: 'dismissTactic' }
  | { type: 'togglePanel' }

export type ExtensionToPanelMessage = {
  type: 'stateUpdate'
  payload: ProjectionState
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const asString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim().length > 0
    ? value
    : null
)

export const parsePanelToExtensionMessage = (
  raw: unknown
): PanelToExtensionMessage | null => {
  const message = asRecord(raw)
  if (!message) {
    return null
  }

  const type = message.type
  if (typeof type !== 'string') {
    return null
  }

  switch (type) {
    case 'togglePanel':
      return { type }
    case 'commitTactic':
      return { type }
    case 'dismissTactic':
      return { type }
    case 'selectGoal': {
      const payload = asRecord(message.payload)
      const goalIdRaw = payload?.goalId
      if (goalIdRaw === null) {
        return {
          type,
          payload: { goalId: null }
        }
      }

      const goalId = asString(goalIdRaw)
      if (!goalId) {
        return null
      }

      return {
        type,
        payload: { goalId }
      }
    }
    case 'applyTactic': {
      const payload = asRecord(message.payload)
      const goalId = asString(payload?.goalId)
      const tactic = asString(payload?.tactic)
      if (!goalId || !tactic) {
        return null
      }

      return {
        type,
        payload: { goalId, tactic }
      }
    }
    default:
      return null
  }
}

export const parseExtensionToPanelMessage = (
  raw: unknown
): ExtensionToPanelMessage | null => {
  const message = asRecord(raw)
  if (!message || message.type !== 'stateUpdate') {
    return null
  }

  const payload = asRecord(message.payload)
  if (!payload) {
    return null
  }

  return {
    type: 'stateUpdate',
    payload: message.payload as ProjectionState
  }
}
