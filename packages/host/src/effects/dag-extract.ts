import type { ProofDAG } from '@proof-flow/schema'

export type DagExtractInput = {
  fileUri: string
}

export type DagExtractHandler = (input: DagExtractInput) => Promise<ProofDAG>

export const dagExtractPlaceholder: DagExtractHandler = async () => {
  throw new Error('proof_flow.dag.extract not implemented')
}
