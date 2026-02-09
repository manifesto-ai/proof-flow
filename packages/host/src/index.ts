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
  createDiagnoseEffect,
  type CreateDiagnoseEffectOptions
} from './effects/diagnose.js'
import {
  createSorryAnalyzeEffect,
  type CreateSorryAnalyzeEffectOptions
} from './effects/sorry-analyze.js'
import {
  createBreakageAnalyzeEffect,
  type CreateBreakageAnalyzeEffectOptions
} from './effects/breakage-analyze.js'

export type CreateProofFlowEffectsOptions = {
  dagExtract: CreateDagExtractEffectOptions
  editorReveal: CreateEditorRevealEffectOptions
  editorGetCursor: CreateEditorGetCursorEffectOptions
  diagnose?: CreateDiagnoseEffectOptions
  sorryAnalyze?: CreateSorryAnalyzeEffectOptions
  breakageAnalyze?: CreateBreakageAnalyzeEffectOptions
}

export const createProofFlowEffects = (
  options: CreateProofFlowEffectsOptions
): Record<string, HostEffectHandler> => ({
  'proof_flow.dag.extract': createDagExtractEffect(options.dagExtract),
  'proof_flow.editor.reveal': createEditorRevealEffect(options.editorReveal),
  'proof_flow.editor.getCursor': createEditorGetCursorEffect(options.editorGetCursor),
  'proof_flow.diagnose': createDiagnoseEffect(options.diagnose),
  'proof_flow.sorry.analyze': createSorryAnalyzeEffect(options.sorryAnalyze),
  'proof_flow.breakage.analyze': createBreakageAnalyzeEffect(options.breakageAnalyze)
})

export * from './effects/dag-extract.js'
export * from './effects/editor-reveal.js'
export * from './effects/cursor-get.js'
export * from './effects/diagnose.js'
export * from './effects/sorry-analyze.js'
export * from './effects/breakage-analyze.js'
export * from './effects/goal-signature.js'
export * from './effects/types.js'
export * from './lean/types.js'
export * from './lean/error-category.js'
export * from './lean/parser.js'
export * from './schemas/proof-dag.js'
