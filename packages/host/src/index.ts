import type { HostEffectHandler } from './effects/types.js'
import {
  createDagExtractEffect,
  type CreateDagExtractEffectOptions
} from './effects/dag-extract.js'
import {
  createEditorRevealEffect,
  type CreateEditorRevealEffectOptions
} from './effects/editor-reveal.js'
import {
  createEditorGetCursorEffect,
  type CreateEditorGetCursorEffectOptions
} from './effects/cursor-get.js'

export type CreateProofFlowEffectsOptions = {
  dagExtract: CreateDagExtractEffectOptions
  editorReveal: CreateEditorRevealEffectOptions
  editorGetCursor: CreateEditorGetCursorEffectOptions
}

export const createProofFlowEffects = (
  options: CreateProofFlowEffectsOptions
): Record<string, HostEffectHandler> => ({
  'proof_flow.dag.extract': createDagExtractEffect(options.dagExtract),
  'proof_flow.editor.reveal': createEditorRevealEffect(options.editorReveal),
  'proof_flow.editor.getCursor': createEditorGetCursorEffect(options.editorGetCursor)
})

export * from './effects/dag-extract.js'
export * from './effects/editor-reveal.js'
export * from './effects/cursor-get.js'
export * from './effects/types.js'
export * from './lean/types.js'
export * from './lean/error-category.js'
export * from './lean/parser.js'
export * from './schemas/proof-dag.js'
