import type { ProjectionState } from './projection-state.js'

export type PanelToExtensionMessage =
  | { type: 'nodeClick'; payload: { nodeId: string } }
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
    case 'nodeClick': {
      const payload = asRecord(message.payload)
      const nodeId = asString(payload?.nodeId)
      if (!nodeId) {
        return null
      }

      return {
        type,
        payload: { nodeId }
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
