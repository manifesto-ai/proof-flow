import { z } from 'zod'

const NodeKindSchema = z.enum([
  'theorem',
  'lemma',
  'have',
  'let',
  'suffices',
  'show',
  'calc_step',
  'case',
  'sorry',
  'tactic_block'
])

const StatusKindSchema = z.enum(['resolved', 'error', 'sorry', 'in_progress'])

const ErrorCategorySchema = z.enum([
  'TYPE_MISMATCH',
  'UNKNOWN_IDENTIFIER',
  'TACTIC_FAILED',
  'UNSOLVED_GOALS',
  'TIMEOUT',
  'KERNEL_ERROR',
  'SYNTAX_ERROR',
  'OTHER'
])

export const RangeSchema = z.object({
  startLine: z.number().int().min(1),
  startCol: z.number().int().min(0),
  endLine: z.number().int().min(1),
  endCol: z.number().int().min(0)
}).refine((range) => {
  if (range.endLine > range.startLine) {
    return true
  }

  return range.endCol >= range.startCol
}, {
  message: 'range end must be after range start'
})

const NodeStatusSchema = z.object({
  kind: StatusKindSchema,
  errorMessage: z.string().nullable(),
  errorCategory: ErrorCategorySchema.nullable()
})

const GoalSnapshotSchema = z.object({
  before: z.string(),
  after: z.string().nullable(),
  tactic: z.string(),
  appliedLemmas: z.array(z.string()),
  subgoalsCreated: z.number().int().min(0)
})

export const ProofNodeSchema = z.object({
  id: z.string().min(1),
  kind: NodeKindSchema,
  label: z.string(),
  leanRange: RangeSchema,
  goalCurrent: z.string().nullable(),
  goalSnapshots: z.array(GoalSnapshotSchema),
  estimatedDistance: z.number().nullable(),
  status: NodeStatusSchema,
  children: z.array(z.string().min(1)),
  dependencies: z.array(z.string().min(1))
})

const ProofProgressSchema = z.object({
  totalGoals: z.number().int().min(0),
  resolvedGoals: z.number().int().min(0),
  blockedGoals: z.number().int().min(0),
  sorryGoals: z.number().int().min(0),
  estimatedRemaining: z.number().int().min(0).nullable()
})

const areKnownNodeReferences = (
  nodes: Record<string, z.infer<typeof ProofNodeSchema>>,
  refs: readonly string[]
): boolean => refs.every((ref) => Object.prototype.hasOwnProperty.call(nodes, ref))

const isAcyclicByChildren = (nodes: Record<string, z.infer<typeof ProofNodeSchema>>): boolean => {
  const visited = new Set<string>()
  const stack = new Set<string>()

  const visit = (nodeId: string): boolean => {
    if (stack.has(nodeId)) {
      return false
    }

    if (visited.has(nodeId)) {
      return true
    }

    visited.add(nodeId)
    stack.add(nodeId)

    for (const childId of nodes[nodeId]?.children ?? []) {
      if (!visit(childId)) {
        return false
      }
    }

    stack.delete(nodeId)
    return true
  }

  return Object.keys(nodes).every(visit)
}

export const ProofDagSchema = z.object({
  fileUri: z.string().min(1),
  rootIds: z.array(z.string().min(1)),
  nodes: z.record(z.string(), ProofNodeSchema),
  extractedAt: z.number().int().nonnegative(),
  progress: ProofProgressSchema.nullable()
})
  .refine((dag) => dag.rootIds.every((id) => Object.prototype.hasOwnProperty.call(dag.nodes, id)), {
    message: 'all rootIds must exist in nodes'
  })
  .refine((dag) => Object.values(dag.nodes).every((node) => areKnownNodeReferences(dag.nodes, node.children)), {
    message: 'all node children must exist in nodes'
  })
  .refine((dag) => Object.values(dag.nodes).every((node) => areKnownNodeReferences(dag.nodes, node.dependencies)), {
    message: 'all node dependencies must exist in nodes'
  })
  .refine((dag) => isAcyclicByChildren(dag.nodes), {
    message: 'dag must be acyclic by children edges'
  })

export type ProofDagValidated = z.infer<typeof ProofDagSchema>

export const validateProofDag = (candidate: unknown): ProofDagValidated | null => {
  const result = ProofDagSchema.safeParse(candidate)
  return result.success ? result.data : null
}
