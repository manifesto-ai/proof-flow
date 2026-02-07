import * as vscode from 'vscode'
import type { AppState } from '@manifesto-ai/app'
import type {
  DagMetrics,
  LayoutDirection,
  ProofDAG,
  ProofFlowState,
  ProofNode
} from '@proof-flow/schema'

export type ProjectionNode = {
  id: string
  label: string
  kind: ProofNode['kind']
  statusKind: ProofNode['status']['kind']
  errorMessage: string | null
  errorCategory: ProofNode['status']['errorCategory']
  startLine: number
  endLine: number
  startCol: number
  endCol: number
  children: string[]
  dependencies: string[]
}

export type ProjectionState = {
  ui: {
    panelVisible: boolean
    activeFileUri: string | null
    selectedNodeId: string | null
    cursorNodeId: string | null
    layout: LayoutDirection
    zoom: number
    collapseResolved: boolean
  }
  activeDag: {
    fileUri: string
    rootIds: string[]
    totalNodes: number
  } | null
  summaryMetrics: DagMetrics | null
  nodes: ProjectionNode[]
  selectedNode: ProjectionNode | null
}

export type ProjectionPanelActions = {
  onNodeSelect: (nodeId: string) => Promise<void>
  onTogglePanel: () => Promise<void>
  onSetLayout: (layout: LayoutDirection) => Promise<void>
  onSetZoom: (zoom: number) => Promise<void>
  onToggleCollapse: () => Promise<void>
}

type WebviewMessage =
  | { type: 'nodeClick'; payload?: { nodeId?: string } }
  | { type: 'togglePanel' }
  | { type: 'setLayout'; payload?: { layout?: string } }
  | { type: 'setZoom'; payload?: { zoom?: number } }
  | { type: 'toggleCollapse' }

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

const toProjectionNode = (node: ProofNode): ProjectionNode => ({
  id: node.id,
  label: node.label,
  kind: node.kind,
  statusKind: node.status.kind,
  errorMessage: node.status.errorMessage,
  errorCategory: node.status.errorCategory,
  startLine: node.leanRange.startLine,
  endLine: node.leanRange.endLine,
  startCol: node.leanRange.startCol,
  endCol: node.leanRange.endCol,
  children: [...node.children],
  dependencies: [...node.dependencies]
})

const toProjectionNodes = (dag: ProofDAG | null): ProjectionNode[] => {
  if (!dag) {
    return []
  }

  return Object.values(dag.nodes)
    .map(toProjectionNode)
    .sort((left, right) => {
      if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine
      }

      if (left.startCol !== right.startCol) {
        return left.startCol - right.startCol
      }

      return left.id.localeCompare(right.id)
    })
}

export const selectProjectionState = (appState: AppState<unknown>): ProjectionState => {
  const state = appState.data as ProofFlowState
  const computed = appState.computed as Record<string, unknown>
  const activeDag = (computed['computed.activeDag'] as ProofDAG | null) ?? null
  const selectedNodeRaw = computed['computed.selectedNode'] as ProofNode | null | undefined
  const nodes = toProjectionNodes(activeDag)

  return {
    ui: {
      panelVisible: state.ui.panelVisible,
      activeFileUri: state.ui.activeFileUri,
      selectedNodeId: state.ui.selectedNodeId,
      cursorNodeId: state.ui.cursorNodeId,
      layout: state.ui.layout,
      zoom: state.ui.zoom,
      collapseResolved: state.ui.collapseResolved
    },
    activeDag: activeDag
      ? {
          fileUri: activeDag.fileUri,
          rootIds: [...activeDag.rootIds],
          totalNodes: Object.keys(activeDag.nodes).length
        }
      : null,
    summaryMetrics: (computed['computed.summaryMetrics'] as DagMetrics | null) ?? null,
    nodes,
    selectedNode: selectedNodeRaw ? toProjectionNode(selectedNodeRaw) : null
  }
}

const escapeHtml = (value: string): string => (
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
)

const initialStateForHtml = (state: ProjectionState | null): string => {
  const encoded = JSON.stringify(state ?? {
    ui: {
      panelVisible: true,
      activeFileUri: null,
      selectedNodeId: null,
      cursorNodeId: null,
      layout: 'topDown',
      zoom: 1,
      collapseResolved: false
    },
    activeDag: null,
    summaryMetrics: null,
    nodes: [],
    selectedNode: null
  })
  return encoded.replace(/</g, '\\u003c')
}

const renderHtml = (state: ProjectionState | null): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ProofFlow</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1318;
      --panel: #161d25;
      --panel-2: #1d2630;
      --text: #e8edf3;
      --muted: #95a6ba;
      --ok: #35c57a;
      --err: #ff6f6f;
      --warn: #ffbf47;
      --prog: #58a6ff;
      --line: #263241;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 13px/1.45 "Iosevka", "IBM Plex Sans KR", sans-serif;
      background: radial-gradient(circle at top right, #1f2a34 0, var(--bg) 45%);
      color: var(--text);
      padding: 10px;
    }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .card {
      background: linear-gradient(160deg, var(--panel), var(--panel-2));
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      margin-bottom: 8px;
    }
    .chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 8px;
      color: var(--muted);
      background: rgba(15, 19, 24, 0.35);
      font-size: 12px;
    }
    .btn {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 5px 9px;
      color: var(--text);
      background: #1a2430;
      cursor: pointer;
    }
    .btn:hover { border-color: #406085; }
    .nodes { max-height: 45vh; overflow: auto; display: grid; gap: 6px; }
    .node {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px;
      background: #141b23;
      cursor: pointer;
    }
    .node:hover { border-color: #406085; }
    .node.selected { border-color: #58a6ff; background: #172335; }
    .node.cursor { box-shadow: 0 0 0 1px #ffbf47 inset; }
    .status { font-weight: 700; }
    .status.resolved { color: var(--ok); }
    .status.error { color: var(--err); }
    .status.sorry { color: var(--warn); }
    .status.in_progress { color: var(--prog); }
    .meta { color: var(--muted); font-size: 12px; }
    .empty { color: var(--muted); padding: 16px 0; }
    input[type=range] { width: 140px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="row" id="summary"></div>
  </div>
  <div class="card">
    <div class="row" style="align-items:center;">
      <button class="btn" id="toggleLayout">Layout</button>
      <button class="btn" id="toggleCollapse">Collapse Resolved</button>
      <button class="btn" id="togglePanel">Hide Panel</button>
      <label class="meta" for="zoom">Zoom</label>
      <input id="zoom" type="range" min="0.1" max="5" step="0.1" value="1" />
      <span class="meta" id="zoomValue">1.0x</span>
    </div>
  </div>
  <div class="card">
    <div class="meta" id="activeFile">No active Lean file</div>
    <div class="nodes" id="nodes"></div>
  </div>
  <div class="card">
    <div id="selected"></div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const stateEl = ${JSON.stringify(initialStateForHtml(state))};
    let state = JSON.parse(stateEl);

    const summaryEl = document.getElementById('summary');
    const activeFileEl = document.getElementById('activeFile');
    const nodesEl = document.getElementById('nodes');
    const selectedEl = document.getElementById('selected');
    const zoomEl = document.getElementById('zoom');
    const zoomValueEl = document.getElementById('zoomValue');

    document.getElementById('togglePanel').addEventListener('click', () => {
      vscode.postMessage({ type: 'togglePanel' });
    });
    document.getElementById('toggleCollapse').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleCollapse' });
    });
    document.getElementById('toggleLayout').addEventListener('click', () => {
      const next = state.ui.layout === 'topDown' ? 'leftRight' : 'topDown';
      vscode.postMessage({ type: 'setLayout', payload: { layout: next } });
    });
    zoomEl.addEventListener('change', () => {
      vscode.postMessage({ type: 'setZoom', payload: { zoom: Number(zoomEl.value) } });
    });

    const statusClass = (kind) => kind === 'in_progress' ? 'in_progress' : kind;

    const render = () => {
      const metrics = state.summaryMetrics;
      const total = metrics ? metrics.totalNodes : 0;
      summaryEl.innerHTML = [
        '<span class="chip">Total: ' + total + '</span>',
        '<span class="chip">Resolved: ' + (metrics ? metrics.resolvedCount : 0) + '</span>',
        '<span class="chip">Errors: ' + (metrics ? metrics.errorCount : 0) + '</span>',
        '<span class="chip">Sorry: ' + (metrics ? metrics.sorryCount : 0) + '</span>',
        '<span class="chip">In-Progress: ' + (metrics ? metrics.inProgressCount : 0) + '</span>',
        '<span class="chip">Depth: ' + (metrics ? metrics.maxDepth : 0) + '</span>'
      ].join('');

      activeFileEl.textContent = state.ui.activeFileUri
        ? 'File: ' + state.ui.activeFileUri + ' | Layout: ' + state.ui.layout
        : 'No active Lean file';

      const visibleNodes = state.ui.collapseResolved
        ? state.nodes.filter((node) => node.statusKind !== 'resolved')
        : state.nodes;

      if (visibleNodes.length === 0) {
        nodesEl.innerHTML = '<div class="empty">No nodes to display.</div>';
      } else {
        nodesEl.innerHTML = visibleNodes.map((node) => {
          const selected = state.ui.selectedNodeId === node.id ? 'selected' : '';
          const cursor = state.ui.cursorNodeId === node.id ? 'cursor' : '';
          return ''
            + '<article class="node ' + selected + ' ' + cursor + '" data-node-id="' + escapeHtml(node.id) + '">'
            + '  <div><strong>' + escapeHtml(node.label || node.id) + '</strong></div>'
            + '  <div class="meta">' + escapeHtml(node.kind) + ' · line ' + node.startLine + '-' + node.endLine + '</div>'
            + '  <div class="status ' + statusClass(node.statusKind) + '">' + escapeHtml(node.statusKind) + '</div>'
            + '</article>';
        }).join('');
      }

      const selected = state.selectedNode;
      if (!selected) {
        selectedEl.innerHTML = '<div class="empty">Select a node to inspect details.</div>';
      } else {
        selectedEl.innerHTML = ''
          + '<div><strong>' + escapeHtml(selected.id) + '</strong></div>'
          + '<div class="meta">' + escapeHtml(selected.kind) + ' · '
          + 'line ' + selected.startLine + ':' + selected.startCol + ' - '
          + selected.endLine + ':' + selected.endCol + '</div>'
          + '<div class="status ' + statusClass(selected.statusKind) + '">' + escapeHtml(selected.statusKind) + '</div>'
          + (selected.errorCategory ? '<div class="meta">Category: ' + escapeHtml(selected.errorCategory) + '</div>' : '')
          + (selected.errorMessage ? '<pre class="meta">' + escapeHtml(selected.errorMessage) + '</pre>' : '');
      }

      zoomEl.value = String(state.ui.zoom);
      zoomValueEl.textContent = Number(state.ui.zoom).toFixed(1) + 'x';

      document.querySelectorAll('[data-node-id]').forEach((el) => {
        el.addEventListener('click', () => {
          const nodeId = el.getAttribute('data-node-id');
          if (nodeId) {
            vscode.postMessage({ type: 'nodeClick', payload: { nodeId } });
          }
        });
      });
    };

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type === 'stateUpdate') {
        state = message.payload;
        render();
      }
    });

    render();
  </script>
</body>
</html>`

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

    if (this.panel) {
      void this.panel.webview.postMessage({
        type: 'stateUpdate',
        payload: state
      })
    }
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
        retainContextWhenHidden: true
      }
    )

    panel.webview.html = renderHtml(this.latestState)

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

  private async handleMessage(raw: unknown): Promise<void> {
    const message = raw as WebviewMessage
    if (!message || typeof message !== 'object') {
      return
    }

    switch (message.type) {
      case 'nodeClick': {
        const payload = asRecord(message.payload)
        const nodeId = payload?.nodeId
        if (typeof nodeId === 'string' && nodeId.length > 0) {
          await this.actions.onNodeSelect(nodeId)
        }
        return
      }
      case 'togglePanel':
        await this.actions.onTogglePanel()
        return
      case 'setLayout': {
        const payload = asRecord(message.payload)
        const layout = payload?.layout
        if (layout === 'topDown' || layout === 'leftRight') {
          await this.actions.onSetLayout(layout)
        }
        return
      }
      case 'setZoom': {
        const payload = asRecord(message.payload)
        const zoom = payload?.zoom
        if (typeof zoom === 'number' && Number.isFinite(zoom)) {
          await this.actions.onSetZoom(zoom)
        }
        return
      }
      case 'toggleCollapse':
        await this.actions.onToggleCollapse()
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
