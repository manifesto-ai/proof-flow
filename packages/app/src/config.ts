import {
  createApp,
  type App,
  type AppConfig,
  type Effects
} from '@manifesto-ai/sdk'
import type { ProofFlowState } from '@proof-flow/schema'

export type ProofFlowAppOptions = {
  schema: string
  effects: Effects
  world?: AppConfig['world']
}

const createInitialData = (): ProofFlowState => ({
  goals: {},
  activeGoalId: null,
  lastTactic: null,
  tacticResult: null,
  applyingTactic: null,
  resolvingGoal: null,
  syncingGoals: null
})

export const createProofFlowApp = (options: ProofFlowAppOptions): App => {
  const config: AppConfig = {
    schema: options.schema,
    effects: options.effects,
    initialData: createInitialData(),
    world: options.world,
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
