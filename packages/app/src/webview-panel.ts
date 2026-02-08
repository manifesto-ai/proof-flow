import * as vscode from 'vscode'
import type { LayoutDirection } from '@proof-flow/schema'
import type { ProjectionState } from './projection-state.js'
export { selectProjectionState } from './projection-state.js'

export type ProjectionPanelActions = {
  onNodeSelect: (nodeId: string) => Promise<void>
  onTogglePanel: () => Promise<void>
  onSetLayout: (layout: LayoutDirection) => Promise<void>
  onSetZoom: (zoom: number) => Promise<void>
  onToggleCollapse: () => Promise<void>
  onResetPatterns: () => Promise<void>
  onSuggestTactics: () => Promise<void>
}

type WebviewMessage =
  | { type: 'nodeClick'; payload?: { nodeId?: string } }
  | { type: 'togglePanel' }
  | { type: 'setLayout'; payload?: { layout?: string } }
  | { type: 'setZoom'; payload?: { zoom?: number } }
  | { type: 'toggleCollapse' }
  | { type: 'resetPatterns' }
  | { type: 'suggestTactics' }

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

const initialProjectionState = (): ProjectionState => ({
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
  attemptOverview: {
    totalAttempts: 0,
    fileAttempts: 0,
    selectedNodeAttempts: 0
  },
  nodeHeatmap: {},
  dashboard: {
    totalPatterns: 0,
    qualifiedPatterns: 0,
    errorCategoryTotals: {
      TYPE_MISMATCH: 0,
      UNKNOWN_IDENTIFIER: 0,
      TACTIC_FAILED: 0,
      UNSOLVED_GOALS: 0,
      TIMEOUT: 0,
      KERNEL_ERROR: 0,
      SYNTAX_ERROR: 0,
      OTHER: 0
    },
    topNodeAttempts: []
  },
  nodes: [],
  selectedNode: null,
  selectedNodeHistory: null,
  patternInsights: [],
  selectedNodeSuggestions: []
})

const initialStateForHtml = (state: ProjectionState | null): string => {
  const encoded = JSON.stringify(state ?? initialProjectionState())
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
      --focus: #4b7db2;
      --node-height: 74px;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 10px;
      font: 13px/1.45 "Iosevka", "IBM Plex Sans KR", sans-serif;
      background: radial-gradient(circle at top right, #1f2a34 0, var(--bg) 45%);
      color: var(--text);
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

    .btn:hover { border-color: var(--focus); }

    .meta { color: var(--muted); font-size: 12px; }

    .status-filter {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 12px;
      color: var(--muted);
      background: rgba(15, 19, 24, 0.35);
    }

    .control-input {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 5px 8px;
      color: var(--text);
      background: #111920;
      outline: none;
    }

    .control-input:focus { border-color: var(--focus); }

    .nodes {
      max-height: 48vh;
      min-height: 260px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 4px;
      background: rgba(15, 19, 24, 0.45);
    }

    .node {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px;
      margin-bottom: 6px;
      min-height: var(--node-height);
      background: #141b23;
      cursor: pointer;
    }

    .node:hover { border-color: var(--focus); }
    .node.selected { border-color: #58a6ff; background: #172335; }
    .node.cursor { box-shadow: 0 0 0 1px #ffbf47 inset; }
    .node.heat-none { border-left: 3px solid #2a3441; }
    .node.heat-low { border-left: 3px solid #2f6f4f; }
    .node.heat-medium { border-left: 3px solid #8f6d2e; }
    .node.heat-high { border-left: 3px solid #9b3f4f; }

    .status { font-weight: 700; }
    .status.resolved { color: var(--ok); }
    .status.error { color: var(--err); }
    .status.sorry { color: var(--warn); }
    .status.in_progress { color: var(--prog); }

    .empty { color: var(--muted); padding: 16px 0; }

    input[type=range] { width: 140px; }

    pre.meta {
      margin: 6px 0 0;
      white-space: pre-wrap;
      word-break: break-word;
      font: 12px/1.35 "Iosevka", monospace;
    }
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
      <button class="btn" id="suggestTactics">Suggest Tactics</button>
      <button class="btn" id="resetPatterns">Reset Patterns</button>
      <button class="btn" id="togglePanel">Hide Panel</button>
      <label class="meta" for="zoom">Zoom</label>
      <input id="zoom" type="range" min="0.1" max="5" step="0.1" value="1" />
      <span class="meta" id="zoomValue">1.0x</span>
    </div>
    <div class="row" style="align-items:center; margin-top: 8px;">
      <input id="nodeSearch" class="control-input" type="search" placeholder="Search node label/id/error" />
      <select id="nodeSort" class="control-input">
        <option value="position">Sort: Position</option>
        <option value="status">Sort: Status</option>
        <option value="label">Sort: Label</option>
      </select>
      <label class="status-filter"><input type="checkbox" data-status-filter="error" checked /> error</label>
      <label class="status-filter"><input type="checkbox" data-status-filter="sorry" checked /> sorry</label>
      <label class="status-filter"><input type="checkbox" data-status-filter="in_progress" checked /> in-progress</label>
      <label class="status-filter"><input type="checkbox" data-status-filter="resolved" checked /> resolved</label>
    </div>
  </div>

  <div class="card">
    <div class="meta" id="activeFile">No active Lean file</div>
    <div class="meta" id="visibleInfo" style="margin-top:4px;"></div>
    <div class="nodes" id="nodes"></div>
  </div>

  <div class="card">
    <div id="selected"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const stateEl = ${JSON.stringify(initialStateForHtml(state))};
    let state = JSON.parse(stateEl);

    const view = {
      query: '',
      sort: 'position',
      status: {
        resolved: true,
        error: true,
        sorry: true,
        in_progress: true
      }
    };

    const VIRTUAL_ROW_HEIGHT = 80;
    const VIRTUAL_OVERSCAN = 10;
    let visibleNodes = [];
    let scrollRenderQueued = false;

    const summaryEl = document.getElementById('summary');
    const activeFileEl = document.getElementById('activeFile');
    const visibleInfoEl = document.getElementById('visibleInfo');
    const nodesEl = document.getElementById('nodes');
    const selectedEl = document.getElementById('selected');
    const zoomEl = document.getElementById('zoom');
    const zoomValueEl = document.getElementById('zoomValue');
    const searchEl = document.getElementById('nodeSearch');
    const sortEl = document.getElementById('nodeSort');

    const statusOrder = {
      error: 0,
      sorry: 1,
      in_progress: 2,
      resolved: 3
    };

    const escapeHtml = (value) => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const statusClass = (kind) => kind === 'in_progress' ? 'in_progress' : kind;

    const compareByPosition = (left, right) => {
      if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine;
      }
      if (left.startCol !== right.startCol) {
        return left.startCol - right.startCol;
      }
      return left.id.localeCompare(right.id);
    };

    const compareByStatus = (left, right) => {
      const leftRank = statusOrder[left.statusKind] ?? 99;
      const rightRank = statusOrder[right.statusKind] ?? 99;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return compareByPosition(left, right);
    };

    const compareByLabel = (left, right) => {
      const leftLabel = (left.label || left.id).toLowerCase();
      const rightLabel = (right.label || right.id).toLowerCase();
      const cmp = leftLabel.localeCompare(rightLabel);
      if (cmp !== 0) {
        return cmp;
      }
      return compareByPosition(left, right);
    };

    const sortNodes = (nodes) => {
      const copied = [...nodes];
      switch (view.sort) {
        case 'status':
          copied.sort(compareByStatus);
          return copied;
        case 'label':
          copied.sort(compareByLabel);
          return copied;
        case 'position':
        default:
          copied.sort(compareByPosition);
          return copied;
      }
    };

    const computeVisibleNodes = () => {
      const query = view.query.trim().toLowerCase();
      let nodes = state.nodes;

      if (state.ui.collapseResolved) {
        nodes = nodes.filter((node) => node.statusKind !== 'resolved');
      }

      nodes = nodes.filter((node) => view.status[node.statusKind]);

      if (query.length > 0) {
        nodes = nodes.filter((node) => {
          const haystack = [
            node.id,
            node.label,
            node.kind,
            node.errorCategory || '',
            node.errorMessage || ''
          ].join(' ').toLowerCase();
          return haystack.includes(query);
        });
      }

      return sortNodes(nodes);
    };

    const updateSummary = () => {
      const metrics = state.summaryMetrics;
      const attempts = state.attemptOverview || { totalAttempts: 0, fileAttempts: 0, selectedNodeAttempts: 0 };
      const dashboard = state.dashboard || { totalPatterns: 0, qualifiedPatterns: 0 };
      const total = metrics ? metrics.totalNodes : 0;
      summaryEl.innerHTML = [
        '<span class="chip">Total: ' + total + '</span>',
        '<span class="chip">Visible: ' + visibleNodes.length + '</span>',
        '<span class="chip">Resolved: ' + (metrics ? metrics.resolvedCount : 0) + '</span>',
        '<span class="chip">Errors: ' + (metrics ? metrics.errorCount : 0) + '</span>',
        '<span class="chip">Sorry: ' + (metrics ? metrics.sorryCount : 0) + '</span>',
        '<span class="chip">In-Progress: ' + (metrics ? metrics.inProgressCount : 0) + '</span>',
        '<span class="chip">Depth: ' + (metrics ? metrics.maxDepth : 0) + '</span>',
        '<span class="chip">Attempts(total/file/node): '
          + attempts.totalAttempts + '/' + attempts.fileAttempts + '/' + attempts.selectedNodeAttempts
          + '</span>',
        '<span class="chip">Patterns(qualified/total): '
          + dashboard.qualifiedPatterns + '/' + dashboard.totalPatterns
          + '</span>'
      ].join('');

      activeFileEl.textContent = state.ui.activeFileUri
        ? 'File: ' + state.ui.activeFileUri + ' | Layout: ' + state.ui.layout
        : 'No active Lean file';

      visibleInfoEl.textContent = 'Visible ' + visibleNodes.length + ' / ' + state.nodes.length
        + ' | Query: ' + (view.query.trim().length > 0 ? view.query.trim() : '(none)');
    };

    const renderNodeWindow = () => {
      if (visibleNodes.length === 0) {
        nodesEl.innerHTML = '<div class="empty">No nodes to display.</div>';
        return;
      }

      const viewportHeight = Math.max(nodesEl.clientHeight, VIRTUAL_ROW_HEIGHT);
      const startIndex = Math.max(0, Math.floor(nodesEl.scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
      const maxItems = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT) + (VIRTUAL_OVERSCAN * 2);
      const endIndex = Math.min(visibleNodes.length, startIndex + maxItems);

      const topPadding = startIndex * VIRTUAL_ROW_HEIGHT;
      const bottomPadding = Math.max(0, (visibleNodes.length - endIndex) * VIRTUAL_ROW_HEIGHT);

      const rows = visibleNodes
        .slice(startIndex, endIndex)
        .map((node) => {
          const selected = state.ui.selectedNodeId === node.id ? 'selected' : '';
          const cursor = state.ui.cursorNodeId === node.id ? 'cursor' : '';
          const heat = node.heatLevel || 'none';
          const label = escapeHtml(node.label || node.id);

          return ''
            + '<article class="node heat-' + heat + ' ' + selected + ' ' + cursor + '" data-node-id="' + escapeHtml(node.id) + '">'
            + '  <div><strong>' + label + '</strong></div>'
            + '  <div class="meta">' + escapeHtml(node.kind) + ' · line ' + node.startLine + '-' + node.endLine
            + ' · attempts ' + (node.attemptCount || 0) + '</div>'
            + '  <div class="status ' + statusClass(node.statusKind) + '">' + escapeHtml(node.statusKind) + '</div>'
            + '</article>';
        })
        .join('');

      nodesEl.innerHTML = ''
        + '<div style="height:' + topPadding + 'px;"></div>'
        + rows
        + '<div style="height:' + bottomPadding + 'px;"></div>';
    };

    const renderSelected = () => {
      const selected = state.selectedNode;
      if (!selected) {
        selectedEl.innerHTML = '<div class="empty">Select a node to inspect details.</div>';
        return;
      }

      const history = state.selectedNodeHistory;
      const historyBlock = history
        ? ''
          + '<div class="meta" style="margin-top:8px;">Attempts: '
          + history.totalAttempts
          + ' · Streak: ' + history.currentStreak
          + ' · Last: ' + (history.lastResult || 'none')
          + '</div>'
          + (history.lastErrorCategory
            ? '<div class="meta">Last Error Category: ' + escapeHtml(history.lastErrorCategory) + '</div>'
            : '')
          + (history.recentAttempts && history.recentAttempts.length > 0
            ? '<pre class="meta">Recent Attempts:\\n'
              + history.recentAttempts
                .map((attempt) => {
                  const category = attempt.errorCategory ? ' [' + attempt.errorCategory + ']' : '';
                  return '- ' + attempt.tacticKey + ' -> ' + attempt.result + category;
                })
                .join('\\n')
              + '</pre>'
            : '')
        : '<div class="meta" style="margin-top:8px;">No attempt history for this node.</div>';

      const patternInsights = Array.isArray(state.patternInsights) ? state.patternInsights : [];
      const patternBlock = patternInsights.length > 0
        ? '<pre class="meta">Pattern Insights:\\n'
          + patternInsights
            .slice(0, 3)
            .map((entry) => {
              return '- ' + entry.tacticKey
                + ' @ ' + entry.errorCategory
                + ' => success ' + entry.successCount
                + ', fail ' + entry.failureCount
                + ', sample ' + entry.sampleSize
                + ', winrate ' + Number(entry.successRate || 0).toFixed(2)
                + ', score ' + Number(entry.score || 0).toFixed(2);
            })
            .join('\\n')
          + '</pre>'
        : '<div class="meta">No qualified pattern insights (sample >= 3).</div>';

      const suggestions = Array.isArray(state.selectedNodeSuggestions) ? state.selectedNodeSuggestions : [];
      const suggestionBlock = suggestions.length > 0
        ? '<pre class="meta">Suggested Tactics:\\n'
          + suggestions
            .slice(0, 5)
            .map((entry) => {
              const category = entry.sourceCategory ? ' @ ' + entry.sourceCategory : '';
              return '- ' + entry.tacticKey
                + category
                + ' => score ' + Number(entry.score || 0).toFixed(2)
                + ', sample ' + (entry.sampleSize || 0)
                + ', winrate ' + Number(entry.successRate || 0).toFixed(2);
            })
            .join('\\n')
          + '</pre>'
        : '<div class="meta">No tactic suggestions yet. Run Suggest Tactics.</div>';

      const dashboard = state.dashboard || {
        totalPatterns: 0,
        qualifiedPatterns: 0,
        errorCategoryTotals: {},
        topNodeAttempts: []
      };
      const categoryRows = Object.entries(dashboard.errorCategoryTotals || {})
        .filter(([, value]) => typeof value === 'number' && value > 0)
        .map(([key, value]) => '- ' + key + ': ' + value)
        .slice(0, 5);
      const topNodeRows = Array.isArray(dashboard.topNodeAttempts)
        ? dashboard.topNodeAttempts
          .slice(0, 3)
          .map((entry) => '- ' + entry.nodeId + ' -> ' + entry.totalAttempts + ' (streak ' + entry.currentStreak + ')')
        : [];
      const dashboardBlock = '<pre class="meta">Dashboard:\\n'
        + '- patterns: ' + dashboard.totalPatterns + ' (qualified ' + dashboard.qualifiedPatterns + ')\\n'
        + (categoryRows.length > 0 ? categoryRows.join('\\n') + '\\n' : '')
        + (topNodeRows.length > 0 ? topNodeRows.join('\\n') : '- top nodes: (none)')
        + '</pre>';

      selectedEl.innerHTML = ''
        + '<div><strong>' + escapeHtml(selected.id) + '</strong></div>'
        + '<div class="meta">' + escapeHtml(selected.kind) + ' · '
        + 'line ' + selected.startLine + ':' + selected.startCol + ' - '
        + selected.endLine + ':' + selected.endCol + '</div>'
        + '<div class="status ' + statusClass(selected.statusKind) + '">' + escapeHtml(selected.statusKind) + '</div>'
        + (selected.errorCategory ? '<div class="meta">Category: ' + escapeHtml(selected.errorCategory) + '</div>' : '')
        + (selected.errorMessage ? '<pre class="meta">' + escapeHtml(selected.errorMessage) + '</pre>' : '')
        + historyBlock
        + patternBlock
        + suggestionBlock
        + dashboardBlock;
    };

    const render = ({ resetScroll = false } = {}) => {
      visibleNodes = computeVisibleNodes();
      if (resetScroll) {
        nodesEl.scrollTop = 0;
      }
      updateSummary();
      renderNodeWindow();
      renderSelected();

      zoomEl.value = String(state.ui.zoom);
      zoomValueEl.textContent = Number(state.ui.zoom).toFixed(1) + 'x';
      searchEl.value = view.query;
      sortEl.value = view.sort;
      document.querySelectorAll('[data-status-filter]').forEach((element) => {
        const input = element;
        const status = input.getAttribute('data-status-filter');
        if (!status) {
          return;
        }
        input.checked = !!view.status[status];
      });
    };

    const queueScrollRender = () => {
      if (scrollRenderQueued) {
        return;
      }
      scrollRenderQueued = true;
      requestAnimationFrame(() => {
        scrollRenderQueued = false;
        renderNodeWindow();
      });
    };

    document.getElementById('togglePanel').addEventListener('click', () => {
      vscode.postMessage({ type: 'togglePanel' });
    });

    document.getElementById('toggleCollapse').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleCollapse' });
    });

    document.getElementById('resetPatterns').addEventListener('click', () => {
      vscode.postMessage({ type: 'resetPatterns' });
    });

    document.getElementById('suggestTactics').addEventListener('click', () => {
      vscode.postMessage({ type: 'suggestTactics' });
    });

    document.getElementById('toggleLayout').addEventListener('click', () => {
      const next = state.ui.layout === 'topDown' ? 'leftRight' : 'topDown';
      vscode.postMessage({ type: 'setLayout', payload: { layout: next } });
    });

    zoomEl.addEventListener('change', () => {
      vscode.postMessage({ type: 'setZoom', payload: { zoom: Number(zoomEl.value) } });
    });

    searchEl.addEventListener('input', () => {
      view.query = searchEl.value;
      render({ resetScroll: true });
    });

    sortEl.addEventListener('change', () => {
      view.sort = sortEl.value;
      render({ resetScroll: true });
    });

    document.querySelectorAll('[data-status-filter]').forEach((element) => {
      element.addEventListener('change', () => {
        const input = element;
        const status = input.getAttribute('data-status-filter');
        if (!status) {
          return;
        }
        view.status[status] = input.checked;
        render({ resetScroll: true });
      });
    });

    nodesEl.addEventListener('scroll', queueScrollRender);

    nodesEl.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const row = target.closest('[data-node-id]');
      if (!row) {
        return;
      }

      const nodeId = row.getAttribute('data-node-id');
      if (nodeId) {
        vscode.postMessage({ type: 'nodeClick', payload: { nodeId } });
      }
    });

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
      case 'resetPatterns':
        await this.actions.onResetPatterns()
        return
      case 'suggestTactics':
        await this.actions.onSuggestTactics()
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
