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

export const ProofNodeSchema = z.object({
  id: z.string().min(1),
  kind: NodeKindSchema,
  label: z.string(),
  leanRange: RangeSchema,
  goal: z.string().nullable(),
  status: NodeStatusSchema,
  children: z.array(z.string().min(1)),
  dependencies: z.array(z.string().min(1))
})

const DagMetricsSchema = z.object({
  totalNodes: z.number().int().min(0),
  resolvedCount: z.number().int().min(0),
  errorCount: z.number().int().min(0),
  sorryCount: z.number().int().min(0),
  inProgressCount: z.number().int().min(0),
  maxDepth: z.number().int().min(0)
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
  metrics: DagMetricsSchema.nullable()
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
