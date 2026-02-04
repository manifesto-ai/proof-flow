export type CursorPosition = {
  line: number
  column: number
}

export type EditorCursor = {
  fileUri: string
  position: CursorPosition
}

export type EditorGetCursorHandler = () => Promise<EditorCursor>

export const editorGetCursorPlaceholder: EditorGetCursorHandler = async () => {
  throw new Error('proof_flow.editor.getCursor not implemented')
}
