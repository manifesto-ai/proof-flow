import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => {
  const makeUri = (value: string) => {
    const normalized = value.startsWith('file://') ? value : `file://${value}`
    const path = normalized.replace('file://', '')
    return {
      path,
      fsPath: path,
      toString: () => normalized
    }
  }

  class Disposable {
    private readonly onDispose?: () => void

    constructor(onDispose?: () => void) {
      this.onDispose = onDispose
    }

    dispose(): void {
      this.onDispose?.()
    }
  }

  class Range {
    readonly start: { line: number; character: number }
    readonly end: { line: number; character: number }

    constructor(startLine: number, startCol: number, endLine: number, endCol: number) {
      this.start = { line: startLine, character: startCol }
      this.end = { line: endLine, character: endCol }
    }
  }

  const listeners = {
    editor: [] as Array<(editor: unknown) => unknown>,
    save: [] as Array<(document: unknown) => unknown>,
    selection: [] as Array<(event: unknown) => unknown>,
    diagnostics: [] as Array<(event: unknown) => unknown>
  }

  const actCalls: Array<{ type: string; input: unknown }> = []
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const panelInstances: any[] = []

  const leanUri = makeUri('file:///active.lean')
  const textUri = makeUri('file:///note.txt')

  const fakeState: any = {
    data: {
      appVersion: '0.1.0',
      files: {
        [leanUri.toString()]: {
          fileUri: leanUri.toString(),
          dag: {
            fileUri: leanUri.toString(),
            rootIds: ['root'],
            nodes: {
              root: {
                id: 'root',
                kind: 'theorem',
                label: 'root',
                leanRange: { startLine: 1, startCol: 0, endLine: 1, endCol: 10 },
                goal: null,
                status: { kind: 'resolved', errorMessage: null, errorCategory: null },
                children: [],
                dependencies: []
              }
            },
            extractedAt: 1,
            metrics: {
              totalNodes: 1,
              resolvedCount: 1,
              errorCount: 0,
              sorryCount: 0,
              inProgressCount: 0,
              maxDepth: 0
            }
          },
          lastSyncedAt: 1
        }
      },
      ui: {
        panelVisible: true,
        activeFileUri: leanUri.toString(),
        selectedNodeId: null,
        cursorNodeId: null,
        layout: 'topDown',
        zoom: 1,
        collapseResolved: false
      },
      history: { version: '0.2.0', files: {} },
      patterns: { version: '0.3.0', entries: {}, totalAttempts: 0, updatedAt: null }
    },
    computed: {
      'computed.activeDag': null,
      'computed.summaryMetrics': null,
      'computed.selectedNode': null
    },
    system: {
      status: 'idle',
      lastError: null,
      errors: [],
      pendingRequirements: [],
      currentAction: null
    },
    meta: {
      version: 1,
      timestamp: 1,
      randomSeed: 'seed',
      schemaHash: 'schema'
    }
  }

  const fakeApp = {
    ready: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    act: vi.fn((type: string, input?: unknown) => {
      actCalls.push({ type, input })
      if (type === 'panel_toggle') {
        fakeState.data.ui.panelVisible = !fakeState.data.ui.panelVisible
      }
      if (type === 'cursor_sync') {
        fakeState.data.ui.cursorNodeId = (input as { resolvedNodeId?: string | null })?.resolvedNodeId ?? null
      }
      return {
        done: async () => {}
      }
    }),
    getState: vi.fn(() => fakeState),
    subscribe: vi.fn((selector: (state: unknown) => unknown, listener: (selected: unknown) => void) => {
      listener(selector(fakeState))
      return () => {}
    })
  }

  const createProofFlowApp = vi.fn(() => fakeApp as any)
  const createProofFlowWorld = vi.fn(async () => ({ store: {} }))
  const resolveNodeIdAtCursor = vi.fn(() => 'root')

  const window = {
    activeTextEditor: {
      document: {
        languageId: 'lean',
        uri: leanUri,
        getText: () => 'theorem t : True := by exact True.intro'
      },
      selection: {
        active: { line: 0, character: 0 }
      },
      revealRange: vi.fn()
    },
    showTextDocument: vi.fn(async () => window.activeTextEditor),
    onDidChangeActiveTextEditor: (cb: (editor: unknown) => unknown) => {
      listeners.editor.push(cb)
      return new Disposable()
    },
    onDidChangeTextEditorSelection: (cb: (event: unknown) => unknown) => {
      listeners.selection.push(cb)
      return new Disposable()
    },
    showWarningMessage: vi.fn(async () => undefined),
    showErrorMessage: vi.fn(async () => undefined),
    showInformationMessage: vi.fn(async () => undefined)
  }

  const workspace = {
    workspaceFolders: [{ uri: makeUri('file:///workspace') }],
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => '')
    })),
    fs: {
      readFile: vi.fn(async () => new TextEncoder().encode('domain ProofFlow { state { v: number = 1 } }'))
    },
    openTextDocument: vi.fn(async (uri: { toString: () => string; path: string }) => ({
      uri,
      path: uri.path,
      languageId: uri.path.endsWith('.lean') ? 'lean' : 'text',
      getText: () => 'theorem x : True := by exact True.intro'
    })),
    onDidSaveTextDocument: (cb: (document: unknown) => unknown) => {
      listeners.save.push(cb)
      return new Disposable()
    }
  }

  const languages = {
    getDiagnostics: vi.fn(() => []),
    onDidChangeDiagnostics: (cb: (event: unknown) => unknown) => {
      listeners.diagnostics.push(cb)
      return new Disposable()
    }
  }

  const registerCommand = vi.fn((id: string, handler: (...args: unknown[]) => unknown) => {
    commands.set(id, handler)
    return new Disposable()
  })

  const vscodeMock = {
    window,
    workspace,
    languages,
    extensions: {
      all: [],
      getExtension: vi.fn(() => undefined)
    },
    commands: {
      registerCommand
    },
    Uri: {
      parse: (value: string) => makeUri(value),
      joinPath: (base: { toString: () => string }, ...parts: string[]) => {
        const joined = `${base.toString().replace(/\/$/, '')}/${parts.join('/')}`
        return makeUri(joined)
      }
    },
    TextEditorRevealType: {
      InCenter: 2
    },
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3
    },
    Range,
    Disposable
  }

  const reset = () => {
    actCalls.splice(0)
    commands.clear()
    panelInstances.splice(0)

    listeners.editor.splice(0)
    listeners.save.splice(0)
    listeners.selection.splice(0)
    listeners.diagnostics.splice(0)

    fakeState.data.ui.panelVisible = true
    fakeState.data.ui.cursorNodeId = null

    window.activeTextEditor = {
      document: {
        languageId: 'lean',
        uri: leanUri,
        getText: () => 'theorem t : True := by exact True.intro'
      },
      selection: {
        active: { line: 0, character: 0 }
      },
      revealRange: vi.fn()
    }

    createProofFlowApp.mockClear()
    createProofFlowWorld.mockClear()
    resolveNodeIdAtCursor.mockClear()
    registerCommand.mockClear()
    fakeApp.ready.mockClear()
    fakeApp.dispose.mockClear()
    fakeApp.act.mockClear()
    fakeApp.getState.mockClear()
    fakeApp.subscribe.mockClear()
    workspace.fs.readFile.mockClear()
    workspace.openTextDocument.mockClear()
    window.showWarningMessage.mockClear()
    window.showErrorMessage.mockClear()
    window.showInformationMessage.mockClear()
    languages.getDiagnostics.mockClear()
    vscodeMock.extensions.getExtension.mockClear()
  }

  const fire = async (list: Array<(event: unknown) => unknown>, event: unknown) => {
    for (const listener of list) {
      await listener(event)
    }
  }

  class ProjectionPanelController {
    private open = false
    readonly setState = vi.fn()
    readonly reveal = vi.fn(() => {
      this.open = true
    })
    readonly dispose = vi.fn(() => {
      this.open = false
    })

    constructor(_context: unknown, readonly actions: unknown) {
      panelInstances.push(this)
    }

    isOpen(): boolean {
      return this.open
    }
  }

  const selectProjectionState = vi.fn((state: any) => ({
    ui: state.data.ui,
    activeDag: null,
    summaryMetrics: null,
    nodes: [],
    selectedNode: null,
    startHereQueue: []
  }))

  return {
    leanUri,
    textUri,
    vscodeMock,
    createProofFlowApp,
    createProofFlowWorld,
    resolveNodeIdAtCursor,
    selectProjectionState,
    ProjectionPanelController,
    fireEditorChange: (event: unknown) => fire(listeners.editor, event),
    fireSave: (event: unknown) => fire(listeners.save, event),
    fireSelection: (event: unknown) => fire(listeners.selection, event),
    fireDiagnostics: (event: unknown) => fire(listeners.diagnostics, event),
    getActCalls: () => [...actCalls],
    getCommand: (id: string) => commands.get(id),
    getPanel: () => panelInstances[0],
    fakeState,
    fakeApp,
    reset
  }
})

vi.mock('vscode', () => env.vscodeMock as any)

vi.mock('../packages/app/src/config.js', () => ({
  createProofFlowApp: env.createProofFlowApp
}))

vi.mock('../packages/app/src/worldstore.js', () => ({
  createProofFlowWorld: env.createProofFlowWorld
}))

vi.mock('@proof-flow/host', () => ({
  createProofFlowEffects: () => ({}),
  resolveNodeIdAtCursor: env.resolveNodeIdAtCursor
}))

vi.mock('../packages/app/src/webview-panel.js', () => ({
  ProjectionPanelController: env.ProjectionPanelController,
  selectProjectionState: env.selectProjectionState
}))

describe('Extension E2E flow', () => {
  beforeEach(async () => {
    env.reset()
    vi.resetModules()
  })

  it('dispatches editor/save/diagnostics/selection events through app.act', async () => {
    const extension = await import('../packages/app/src/extension.ts')
    const context = { subscriptions: [] as Array<{ dispose: () => void }> }

    await extension.activate(context as any)

    expect(env.createProofFlowWorld).toHaveBeenCalledTimes(1)
    expect(env.createProofFlowApp).toHaveBeenCalledTimes(1)

    const initialTypes = env.getActCalls().map((call) => call.type)
    expect(initialTypes).toContain('file_activate')
    expect(initialTypes).toContain('dag_sync')

    await env.fireEditorChange({
      document: {
        languageId: 'lean',
        uri: env.leanUri
      }
    })

    await env.fireSave({
      languageId: 'lean',
      uri: env.leanUri
    })

    await env.fireDiagnostics({
      uris: [env.leanUri, env.textUri]
    })

    await env.fireSelection({
      textEditor: {
        document: {
          languageId: 'lean',
          uri: env.leanUri
        }
      },
      selections: [
        {
          active: {
            line: 0,
            character: 2
          }
        }
      ]
    })

    await env.fireSave({
      languageId: 'lean',
      uri: env.leanUri
    })

    const calls = env.getActCalls()
    const types = calls.map((call) => call.type)

    expect(types.filter((type) => type === 'file_activate').length).toBeGreaterThanOrEqual(2)
    expect(types.filter((type) => type === 'dag_sync').length).toBeGreaterThanOrEqual(4)
    expect(types).toContain('cursor_sync')
    expect(types).toContain('attempt_record')

    const cursorSyncCall = calls.findLast((call) => call.type === 'cursor_sync')
    expect(cursorSyncCall?.input).toMatchObject({
      resolvedNodeId: expect.any(String)
    })

    const panel = env.getPanel()
    expect(panel).toBeDefined()
    expect(panel.setState).toHaveBeenCalled()

    await extension.deactivate()
    expect(env.fakeApp.dispose).toHaveBeenCalledTimes(1)
    expect(panel.dispose).toHaveBeenCalledTimes(1)
  })

  it('handles toggle command by reveal-first then panel_toggle', async () => {
    const extension = await import('../packages/app/src/extension.ts')
    const context = { subscriptions: [] as Array<{ dispose: () => void }> }

    await extension.activate(context as any)

    const command = env.getCommand('proof-flow.hello')
    expect(command).toBeTypeOf('function')

    const panel = env.getPanel()
    const callCountBefore = env.getActCalls().length

    await command?.()
    expect(panel.reveal).toHaveBeenCalledTimes(1)
    expect(env.getActCalls().length).toBe(callCountBefore)

    await command?.()
    const callTypes = env.getActCalls().map((call) => call.type)
    expect(callTypes).toContain('panel_toggle')

    await extension.deactivate()
  })

  it('dispatches pattern reset from command and panel action', async () => {
    const extension = await import('../packages/app/src/extension.ts')
    const context = { subscriptions: [] as Array<{ dispose: () => void }> }

    await extension.activate(context as any)

    const resetCommand = env.getCommand('proof-flow.patternsReset')
    expect(resetCommand).toBeTypeOf('function')

    await resetCommand?.()

    const panel = env.getPanel() as { actions: { onResetPatterns: () => Promise<void> } }
    await panel.actions.onResetPatterns()

    const resetCalls = env.getActCalls().filter((call) => call.type === 'patterns_reset')
    expect(resetCalls.length).toBe(2)

    await extension.deactivate()
  })

  it('dispatches tactic suggestion from command and panel action', async () => {
    const extension = await import('../packages/app/src/extension.ts')
    const context = { subscriptions: [] as Array<{ dispose: () => void }> }

    await extension.activate(context as any)
    env.fakeState.data.ui.cursorNodeId = 'root'

    const suggestCommand = env.getCommand('proof-flow.suggestTactics')
    expect(suggestCommand).toBeTypeOf('function')

    await suggestCommand?.()

    const panel = env.getPanel() as { actions: { onSuggestTactics: () => Promise<void> } }
    await panel.actions.onSuggestTactics()

    const suggestCalls = env.getActCalls().filter((call) => call.type === 'attempt_suggest')
    expect(suggestCalls.length).toBe(2)
    expect(suggestCalls[0]?.input).toMatchObject({
      fileUri: env.leanUri.toString(),
      nodeId: 'root'
    })

    await extension.deactivate()
  })

  it('dispatches node_select from panel selection action', async () => {
    const extension = await import('../packages/app/src/extension.ts')
    const context = { subscriptions: [] as Array<{ dispose: () => void }> }

    await extension.activate(context as any)

    const panel = env.getPanel() as { actions: { onNodeSelect: (nodeId: string) => Promise<void> } }
    await panel.actions.onNodeSelect('root')

    const nodeSelectCall = env.getActCalls().findLast((call) => call.type === 'node_select')
    expect(nodeSelectCall?.input).toMatchObject({ nodeId: 'root' })

    await extension.deactivate()
  })

  it('applies selected suggestion through panel action', async () => {
    const extension = await import('../packages/app/src/extension.ts')
    const context = { subscriptions: [] as Array<{ dispose: () => void }> }

    await extension.activate(context as any)
    env.fakeState.data.ui.cursorNodeId = 'root'

    const panel = env.getPanel() as { actions: { onApplySuggestion: (tacticKey: string) => Promise<void> } }
    await panel.actions.onApplySuggestion('simp')

    const calls = env.getActCalls()
    const applyCall = calls.find((call) => call.type === 'attempt_apply')
    expect(applyCall?.input).toMatchObject({
      fileUri: env.leanUri.toString(),
      nodeId: 'root',
      tactic: 'simp',
      tacticKey: 'simp'
    })

    expect(calls.map((call) => call.type)).toContain('dag_sync')
    expect(calls.map((call) => call.type)).toContain('attempt_suggest')

    await extension.deactivate()
  })

  it('reports goal coverage for active DAG', async () => {
    const extension = await import('../packages/app/src/extension.ts')
    const context = { subscriptions: [] as Array<{ dispose: () => void }> }

    await extension.activate(context as any)

    const snapshotCommand = env.getCommand('proof-flow.goalCoverageSnapshot')
    expect(snapshotCommand).toBeTypeOf('function')

    const snapshot = await snapshotCommand?.() as {
      sourceKpi?: {
        totalHints?: number
        stableHints?: number
        fallbackHints?: number
        stableRatio?: number
        fallbackRatio?: number
        alerts?: string[]
      }
    } | undefined
    expect(snapshot?.sourceKpi).toMatchObject({
      totalHints: 0,
      stableHints: 0,
      fallbackHints: 0,
      stableRatio: 0,
      fallbackRatio: 0,
      alerts: expect.arrayContaining(['NO_HINTS'])
    })

    const reportCommand = env.getCommand('proof-flow.goalCoverageReport')
    expect(reportCommand).toBeTypeOf('function')

    await reportCommand?.()

    expect(env.vscodeMock.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Goal coverage')
    )
    expect(env.vscodeMock.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('stableRatio=')
    )

    await extension.deactivate()
  })
})
