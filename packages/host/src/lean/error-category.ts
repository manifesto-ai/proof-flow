import type { ErrorCategory } from '@proof-flow/schema'

type PatternRule = {
  category: ErrorCategory
  patterns: RegExp[]
}

const RULES: readonly PatternRule[] = [
  {
    category: 'TIMEOUT',
    patterns: [
      /timeout/i,
      /heartbeats? exceeded/i,
      /maximum recursion depth/i
    ]
  },
  {
    category: 'UNKNOWN_IDENTIFIER',
    patterns: [
      /unknown identifier/i,
      /unknown constant/i,
      /unknown namespace/i,
      /invalid field/i
    ]
  },
  {
    category: 'TYPE_MISMATCH',
    patterns: [
      /type mismatch/i,
      /has type .* expected/i,
      /expected .* but got/i,
      /application type mismatch/i
    ]
  },
  {
    category: 'TACTIC_FAILED',
    patterns: [
      /tactic .* failed/i,
      /failed to unify/i,
      /cannot close goal/i,
      /no goals to be solved/i
    ]
  },
  {
    category: 'UNSOLVED_GOALS',
    patterns: [
      /unsolved goals?/i,
      /goals? remaining/i,
      /declaration has unsolved goals/i
    ]
  },
  {
    category: 'KERNEL_ERROR',
    patterns: [
      /kernel type error/i,
      /kernel exception/i,
      /failed to compile declaration/i
    ]
  },
  {
    category: 'SYNTAX_ERROR',
    patterns: [
      /invalid syntax/i,
      /unexpected token/i,
      /parse error/i,
      /expected .*/i
    ]
  }
]

export const classifyLeanErrorCategory = (message: string): ErrorCategory => {
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(message))) {
      return rule.category
    }
  }

  return 'OTHER'
}
