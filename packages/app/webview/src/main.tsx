import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import type { ProjectionState } from '../../src/projection-state.js'
import type { PanelToExtensionMessage } from '../../src/panel-contract.js'
import App from './App'
import './styles.css'

type VsCodeApi = {
  postMessage: (message: PanelToExtensionMessage) => void
}

declare const acquireVsCodeApi: () => VsCodeApi

declare global {
  interface Window {
    __PROOF_FLOW_INITIAL_STATE__?: ProjectionState
  }
}

const toDefaultProjectionState = (): ProjectionState => ({
  ui: {
    panelVisible: true,
    activeFileUri: null,
    selectedNodeId: null,
    cursorNodeId: null
  },
  activeDag: null,
  progress: null,
  nodes: [],
  selectedNode: null,
  goalChain: [],
  hasSorries: false,
  sorryQueue: [],
  hasError: false,
  activeDiagnosis: null,
  breakageMap: null,
  runtimeDebug: {
    world: {
      headWorldId: null,
      depth: null,
      branchId: null
    }
  }
})

const vscode = acquireVsCodeApi()
const initialState = window.__PROOF_FLOW_INITIAL_STATE__ ?? toDefaultProjectionState()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Webview root element not found.')
}

createRoot(rootElement).render(
  <StrictMode>
    <App
      initialState={initialState}
      postMessage={(message) => {
        vscode.postMessage(message)
      }}
    />
  </StrictMode>
)
