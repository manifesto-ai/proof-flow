import { createApp, type App, type AppConfig, type Effects } from '@manifesto-ai/app'

export type ProofFlowAppOptions = {
  schema: string
  effects: Effects
}

/**
 * Manifesto v2.2+ uses effects-first AppConfig.
 * Host/World are created internally unless a custom world is injected.
 */
export const createProofFlowApp = (options: ProofFlowAppOptions): App => {
  const config: AppConfig = {
    schema: options.schema,
    effects: options.effects,
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
