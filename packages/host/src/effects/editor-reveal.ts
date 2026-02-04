import type { Range } from '@proof-flow/schema'

export type EditorRevealInput = {
  fileUri: string
  range: Range
}

export type EditorRevealHandler = (input: EditorRevealInput) => Promise<void>

export const editorRevealPlaceholder: EditorRevealHandler = async () => {
  throw new Error('proof_flow.editor.reveal not implemented')
}
