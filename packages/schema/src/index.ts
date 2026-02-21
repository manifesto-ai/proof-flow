export type GoalStatus = 'open' | 'resolved' | 'failed'

export type Goal = {
  id: string
  statement: string
  status: GoalStatus
}

export type TacticResult = {
  goalId: string
  tactic: string
  succeeded: boolean
  newGoalIds: string[]
  errorMessage: string | null
}

export type ProofFlowState = {
  goals: Record<string, Goal>
  activeGoalId: string | null
  lastTactic: string | null
  tacticResult: TacticResult | null
  applyingTactic: string | null
  resolvingGoal: string | null
  syncingGoals: string | null
}
