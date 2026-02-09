import { describe, expect, it } from 'vitest'
import {
  parseExtensionToPanelMessage,
  parsePanelToExtensionMessage
} from '../packages/app/src/panel-contract.js'

describe('panel-contract parser', () => {
  it('parses valid outbound messages', () => {
    expect(parsePanelToExtensionMessage({ type: 'togglePanel' })).toEqual({ type: 'togglePanel' })
    expect(parsePanelToExtensionMessage({ type: 'commitTactic' })).toEqual({ type: 'commitTactic' })
    expect(parsePanelToExtensionMessage({ type: 'dismissTactic' })).toEqual({ type: 'dismissTactic' })

    expect(parsePanelToExtensionMessage({
      type: 'selectGoal',
      payload: { goalId: 'g1' }
    })).toEqual({
      type: 'selectGoal',
      payload: { goalId: 'g1' }
    })

    expect(parsePanelToExtensionMessage({
      type: 'applyTactic',
      payload: { goalId: 'g1', tactic: 'simp' }
    })).toEqual({
      type: 'applyTactic',
      payload: { goalId: 'g1', tactic: 'simp' }
    })
  })

  it('rejects malformed outbound payloads', () => {
    expect(parsePanelToExtensionMessage(null)).toBeNull()
    expect(parsePanelToExtensionMessage({ type: 'selectGoal', payload: {} })).toBeNull()
    expect(parsePanelToExtensionMessage({ type: 'applyTactic', payload: { goalId: 'g1' } })).toBeNull()
    expect(parsePanelToExtensionMessage({ type: 'nodeClick', payload: { nodeId: 'x' } })).toBeNull()
  })

  it('parses inbound state update messages', () => {
    const parsed = parseExtensionToPanelMessage({
      type: 'stateUpdate',
      payload: {
        ui: {
          panelVisible: true
        }
      }
    })

    expect(parsed?.type).toBe('stateUpdate')
    expect(parsed?.payload.ui.panelVisible).toBe(true)

    expect(parseExtensionToPanelMessage({ type: 'unknown' })).toBeNull()
  })
})
