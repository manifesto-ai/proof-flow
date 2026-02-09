import { readFileSync } from 'node:fs'
import * as vscode from 'vscode'
import {
  parsePanelToExtensionMessage,
  type ExtensionToPanelMessage
} from './panel-contract.js'
import type { ProjectionState } from './projection-state.js'
export { selectProjectionState } from './projection-state.js'

export type ProjectionPanelActions = {
  onNodeSelect: (nodeId: string) => Promise<void>
  onTogglePanel: () => Promise<void>
}

const initialProjectionState = (): ProjectionState => ({
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

const encodeInitialState = (state: ProjectionState | null): string => {
  const serialized = JSON.stringify(state ?? initialProjectionState())
  return serialized.replace(/</g, '\\u003c')
}

const createNonce = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let value = ''
  for (let index = 0; index < 24; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return value
}

const fallbackHtml = (reason: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ProofFlow</title>
    <style>
      body {
        margin: 0;
        padding: 16px;
        font-family: "Iosevka", "IBM Plex Sans KR", sans-serif;
        background: #0b1220;
        color: #e2e8f0;
      }
      code {
        display: block;
        white-space: pre-wrap;
        margin-top: 8px;
        padding: 8px;
        border-radius: 8px;
        background: #111827;
      }
    </style>
  </head>
  <body>
    <h3>ProofFlow panel assets not found</h3>
    <p>Run <code>pnpm -r build</code> to generate <code>packages/app/dist/webview</code>.</p>
    <code>${reason}</code>
  </body>
</html>`

const toResourceUri = (
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  resourcePath: string
): string => {
  const clean = resourcePath.replace(/^\//, '').replace(/^\.\//, '')
  const segments = clean.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    return resourcePath
  }

  return webview
    .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', ...segments))
    .toString()
}

const rewriteAssetUris = (
  html: string,
  context: vscode.ExtensionContext,
  webview: vscode.Webview
): string => html.replace(/\b(src|href)="([^"]+)"/g, (full, attribute, rawValue) => {
  const value = rawValue as string
  if (
    value.startsWith('http://')
    || value.startsWith('https://')
    || value.startsWith('data:')
    || value.startsWith('#')
    || value.startsWith('vscode-webview://')
  ) {
    return full
  }

  const marker = value.search(/[?#]/)
  const basePath = marker >= 0 ? value.slice(0, marker) : value
  const suffix = marker >= 0 ? value.slice(marker) : ''
  const resourceUri = toResourceUri(context, webview, basePath)
  return `${attribute}="${resourceUri}${suffix}"`
})

const withScriptNonce = (html: string, nonce: string): string => (
  html.replace(/<script\b(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`)
)

export class ProjectionPanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null
  private latestState: ProjectionState | null = null
  private closingFromState = false
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly actions: ProjectionPanelActions
  ) {}

  isOpen(): boolean {
    return this.panel !== null
  }

  dispose(): void {
    this.disposePanel()
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose()
    }
  }

  reveal(): void {
    const panel = this.ensurePanel()
    panel.reveal(vscode.ViewColumn.Beside, true)
  }

  setState(state: ProjectionState): void {
    this.latestState = state

    if (!state.ui.panelVisible) {
      this.disposePanel()
      return
    }

    if (!this.panel) {
      return
    }

    const message: ExtensionToPanelMessage = {
      type: 'stateUpdate',
      payload: state
    }

    void this.panel.webview.postMessage(message)
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) {
      return this.panel
    }

    const panel = vscode.window.createWebviewPanel(
      'proof-flow.projection',
      'ProofFlow',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')
        ]
      }
    )

    panel.webview.html = this.renderHtml(panel.webview, this.latestState)

    this.disposables.push(
      panel.onDidDispose(() => {
        const shouldSyncState = !this.closingFromState
        this.panel = null
        this.closingFromState = false
        if (shouldSyncState && this.latestState?.ui.panelVisible) {
          void this.actions.onTogglePanel()
        }
      }),
      panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message)
      })
    )

    this.panel = panel
    return panel
  }

  private renderHtml(webview: vscode.Webview, state: ProjectionState | null): string {
    const nonce = createNonce()
    const initialStateJson = encodeInitialState(state)

    let html = this.readTemplate()
    html = html.replace(/__INITIAL_STATE__/g, initialStateJson)
    html = html.replace(/__CSP_SOURCE__/g, webview.cspSource)
    html = html.replace(/__NONCE__/g, nonce)
    html = rewriteAssetUris(html, this.context, webview)
    html = withScriptNonce(html, nonce)

    return html
  }

  private readTemplate(): string {
    const templateUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'index.html')

    try {
      return readFileSync(templateUri.fsPath, 'utf8')
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return fallbackHtml(reason)
    }
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const message = parsePanelToExtensionMessage(raw)
    if (!message) {
      return
    }

    switch (message.type) {
      case 'nodeClick':
        await this.actions.onNodeSelect(message.payload.nodeId)
        return
      case 'togglePanel':
        await this.actions.onTogglePanel()
        return
    }
  }

  private disposePanel(): void {
    if (!this.panel) {
      return
    }

    const panel = this.panel
    this.panel = null
    this.closingFromState = true
    panel.dispose()
  }
}
