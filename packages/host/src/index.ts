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
import {
  createAttemptRecordEffect,
  type CreateAttemptRecordEffectOptions
} from './effects/attempt-record.js'
import {
  createAttemptSuggestEffect,
  type CreateAttemptSuggestEffectOptions
} from './effects/attempt-suggest.js'
import {
  createAttemptApplyEffect,
  type CreateAttemptApplyEffectOptions
} from './effects/attempt-apply.js'

export type CreateProofFlowEffectsOptions = {
  dagExtract: CreateDagExtractEffectOptions
  editorReveal: CreateEditorRevealEffectOptions
  editorGetCursor: CreateEditorGetCursorEffectOptions
  attemptRecord?: CreateAttemptRecordEffectOptions
  attemptSuggest?: CreateAttemptSuggestEffectOptions
  attemptApply?: CreateAttemptApplyEffectOptions
}

export const createProofFlowEffects = (
  options: CreateProofFlowEffectsOptions
): Record<string, HostEffectHandler> => ({
  'proof_flow.dag.extract': createDagExtractEffect(options.dagExtract),
  'proof_flow.editor.reveal': createEditorRevealEffect(options.editorReveal),
  'proof_flow.editor.getCursor': createEditorGetCursorEffect(options.editorGetCursor),
  'proof_flow.attempt.record': createAttemptRecordEffect(options.attemptRecord),
  'proof_flow.attempt.suggest': createAttemptSuggestEffect(options.attemptSuggest),
  'proof_flow.attempt.apply': createAttemptApplyEffect(options.attemptApply)
})

export * from './effects/dag-extract.js'
export * from './effects/editor-reveal.js'
export * from './effects/cursor-get.js'
export * from './effects/attempt-record.js'
export * from './effects/attempt-suggest.js'
export * from './effects/attempt-apply.js'
export * from './effects/types.js'
export * from './lean/types.js'
export * from './lean/error-category.js'
export * from './lean/parser.js'
export * from './schemas/proof-dag.js'
