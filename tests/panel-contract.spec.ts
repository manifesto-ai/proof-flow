import { describe, expect, it } from 'vitest'
import {
  parseExtensionToPanelMessage,
  parsePanelToExtensionMessage
} from '../packages/app/src/panel-contract.js'

describe('panel-contract parser', () => {
  it('parses valid outbound messages', () => {
    expect(parsePanelToExtensionMessage({ type: 'togglePanel' })).toEqual({ type: 'togglePanel' })

    expect(parsePanelToExtensionMessage({
      type: 'nodeClick',
      payload: { nodeId: 'root' }
    })).toEqual({
      type: 'nodeClick',
      payload: { nodeId: 'root' }
    })
  })

  it('rejects malformed outbound payloads', () => {
    expect(parsePanelToExtensionMessage(null)).toBeNull()
    expect(parsePanelToExtensionMessage({ type: 'nodeClick', payload: {} })).toBeNull()
    expect(parsePanelToExtensionMessage({ type: 'applySuggestion', payload: { tacticKey: 'x' } })).toBeNull()
  })

  it('parses inbound state update messages', () => {
    const parsed = parseExtensionToPanelMessage({
      type: 'stateUpdate',
      payload: {
        ui: {
          panelVisible: true,
          activeFileUri: null,
          selectedNodeId: null,
          cursorNodeId: null
        }
      }
    })

    expect(parsed?.type).toBe('stateUpdate')
    expect(parsed?.payload.ui.panelVisible).toBe(true)

    expect(parseExtensionToPanelMessage({ type: 'unknown' })).toBeNull()
  })
})
