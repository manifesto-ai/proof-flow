import {
  createApp,
  createSilentPolicyService,
  type App,
  type AppConfig,
  type Effects
} from '@manifesto-ai/app'
import type { ProofFlowState } from '@proof-flow/schema'

export type ProofFlowAppOptions = {
  schema: string
  effects: Effects
  world?: AppConfig['world']
}

const createInitialData = (): ProofFlowState => ({
  appVersion: '0.1.0',
  files: {},
  ui: {
    panelVisible: true,
    activeFileUri: null,
    selectedNodeId: null,
    cursorNodeId: null,
    layout: 'topDown',
    zoom: 1,
    collapseResolved: false
  },
  history: {
    version: '0.2.0',
    files: {}
  },
  patterns: {
    version: '0.3.0',
    entries: {},
    totalAttempts: 0,
    updatedAt: null
  }
})

/**
 * Manifesto v2.2+ uses effects-first AppConfig.
 * Host/World are created internally unless a custom world is injected.
 */
export const createProofFlowApp = (options: ProofFlowAppOptions): App => {
  const config: AppConfig = {
    schema: options.schema,
    effects: options.effects,
    initialData: createInitialData(),
    world: options.world,
    // Keep governance explicit: single-user local workflow auto-approves.
    policyService: createSilentPolicyService(),
    validation: { effects: 'strict' },
    actorPolicy: {
      mode: 'require',
      defaultActor: {
        actorId: 'proof-flow:local-user',
        kind: 'human'
      }
    }
  }

  return createApp(config)
}
