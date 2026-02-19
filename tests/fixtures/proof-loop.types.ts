export type ProofLoopStepType = 'sync' | 'select' | 'apply' | 'commit' | 'dismiss'

export type ProofLoopStep = {
  phase: ProofLoopStepType
  input?: {
    goalId?: string
    tactic?: string
  }
  expected: {
    openGoals?: number
    failedGoals?: number
    tacticPending?: boolean
    succeeded?: boolean
  }
}

export type ProofLoopReport = {
  file: string
  elapsedMs: number
  steps: ProofLoopStep[]
  summary: {
    opens: number
    fails: number
    commits: number
    syncs: number
  }
}
