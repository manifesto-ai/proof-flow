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
    constructor(private readonly onDispose?: () => void) {}

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
      appVersion: '2.0.0',
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
                goalCurrent: null,
                goalSnapshots: [],
                estimatedDistance: 0,
                status: { kind: 'resolved', errorMessage: null, errorCategory: null },
                children: [],
                dependencies: []
              }
            },
            extractedAt: 1,
            progress: {
              totalGoals: 0,
              resolvedGoals: 0,
              blockedGoals: 0,
              sorryGoals: 0,
              estimatedRemaining: 0
            }
          },
          lastSyncedAt: 1
        }
      },
      activeFileUri: leanUri.toString(),
      selectedNodeId: null,
      cursorNodeId: null,
      panelVisible: true,
      sorryQueue: null,
      breakageMap: null,
      activeDiagnosis: null
    },
    computed: {
      'computed.activeDag': null,
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
      if (type === 'panel_set') {
        fakeState.data.panelVisible = (input as { visible?: boolean })?.visible ?? fakeState.data.panelVisible
      }
      if (type === 'cursor_sync') {
        fakeState.data.cursorNodeId = (input as { resolvedNodeId?: string | null })?.resolvedNodeId ?? null
      }
      if (type === 'file_activate') {
        fakeState.data.activeFileUri = (input as { fileUri?: string })?.fileUri ?? null
      }
      if (type === 'node_select') {
        fakeState.data.selectedNodeId = (input as { nodeId?: string })?.nodeId ?? null
      }
      return { done: async () => {} }
    }),
    getState: vi.fn(() => fakeState),
    currentBranch: vi.fn(() => ({
      id: 'main',
      name: 'main',
      schemaHash: 'schema',
      head: () => 'w_head',
      lineage: () => ['w_head', 'w_prev']
    })),
    getCurrentHead: vi.fn(() => 'w_head'),
    getHeads: vi.fn(async () => [
      {
        worldId: 'w_head',
        branchId: 'main',
        branchName: 'main',
        createdAt: 1,
        schemaHash: 'schema'
      }
    ]),
    getLatestHead: vi.fn(async () => ({
      worldId: 'w_head',
      branchId: 'main',
      branchName: 'main',
      createdAt: 1,
      schemaHash: 'schema'
    })),
    subscribe: vi.fn((selector: (state: unknown) => unknown, listener: (selected: unknown) => void) => {
      listener(selector(fakeState))
      return () => {}
    })
  }

  const createProofFlowApp = vi.fn(() => fakeApp as any)
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
    showErrorMessage: vi.fn(async () => undefined)
  }

  const workspace = {
    workspaceFolders: [{ uri: makeUri('file:///workspace') }],
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => '')
    })),
    fs: {
      readFile: vi.fn(async () => new TextEncoder().encode('domain ProofFlow { state { v: number = 1 } }'))
    },
    openTextDocument: vi.fn(async (uri: { path: string }) => ({
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
    commands: { registerCommand },
    Uri: {
      parse: (value: string) => makeUri(value),
      file: (value: string) => makeUri(`file://${value}`),
      joinPath: (base: { toString: () => string }, ...parts: string[]) => {
        const joined = `${base.toString().replace(/\/$/, '')}/${parts.join('/')}`
        return makeUri(joined)
      }
    },
    TextEditorRevealType: { InCenter: 2 },
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3
    },
    Range,
    Disposable,
    ViewColumn: {
      Beside: 2
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
    ui: {
      panelVisible: state.data.panelVisible,
      activeFileUri: state.data.activeFileUri,
      selectedNodeId: state.data.selectedNodeId,
      cursorNodeId: state.data.cursorNodeId
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
  }))

  const reset = () => {
    actCalls.splice(0)
    commands.clear()
    panelInstances.splice(0)
    listeners.editor.splice(0)
    listeners.save.splice(0)
    listeners.selection.splice(0)
    listeners.diagnostics.splice(0)

    fakeState.data.panelVisible = true
    fakeState.data.cursorNodeId = null
    fakeState.data.selectedNodeId = null

    createProofFlowApp.mockClear()
    resolveNodeIdAtCursor.mockClear()
    registerCommand.mockClear()
    fakeApp.ready.mockClear()
    fakeApp.dispose.mockClear()
    fakeApp.act.mockClear()
    fakeApp.getState.mockClear()
    fakeApp.currentBranch.mockClear()
    fakeApp.getCurrentHead.mockClear()
    fakeApp.getHeads.mockClear()
    fakeApp.getLatestHead.mockClear()
    fakeApp.subscribe.mockClear()
    workspace.fs.readFile.mockClear()
    workspace.openTextDocument.mockClear()
    window.showWarningMessage.mockClear()
    window.showErrorMessage.mockClear()
    languages.getDiagnostics.mockClear()
    vscodeMock.extensions.getExtension.mockClear()
  }

  const fire = async (list: Array<(event: unknown) => unknown>, event: unknown) => {
    for (const listener of list) {
      await listener(event)
    }
  }

  const wait = async (ms: number) => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  return {
    leanUri,
    textUri,
    vscodeMock,
    createProofFlowApp,
    resolveNodeIdAtCursor,
    selectProjectionState,
    ProjectionPanelController,
    fireEditorChange: (event: unknown) => fire(listeners.editor, event),
    fireSave: (event: unknown) => fire(listeners.save, event),
    fireSelection: (event: unknown) => fire(listeners.selection, event),
    fireDiagnostics: (event: unknown) => fire(listeners.diagnostics, event),
    wait,
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
vi.mock('@proof-flow/host', () => ({
  createProofFlowEffects: () => ({}),
  resolveNodeIdAtCursor: env.resolveNodeIdAtCursor
}))
vi.mock('../packages/app/src/webview-panel.js', () => ({
  ProjectionPanelController: env.ProjectionPanelController,
  selectProjectionState: env.selectProjectionState
}))

describe('Extension E2E flow (v2)', () => {
  beforeEach(async () => {
    env.reset()
    vi.resetModules()
  })

  it('dispatches editor/save/diagnostics/selection events through app.act', async () => {
    const extension = await import('../packages/app/src/extension.ts')
    const context = { subscriptions: [] as Array<{ dispose: () => void }> }

    await extension.activate(context as any)

    const initialTypes = env.getActCalls().map((call) => call.type)
    expect(initialTypes).toContain('file_activate')
    expect(initialTypes).toContain('dag_sync')

    await env.fireEditorChange({
      document: { languageId: 'lean', uri: env.leanUri }
    })
    await env.fireSave({ languageId: 'lean', uri: env.leanUri })
    await env.fireDiagnostics({ uris: [env.leanUri, env.textUri] })
    await env.fireSelection({
      textEditor: {
        document: { languageId: 'lean', uri: env.leanUri }
      },
      selections: [{ active: { line: 0, character: 2 } }]
    })

    await env.wait(450)
    const types = env.getActCalls().map((call) => call.type)

    expect(types.filter((type) => type === 'file_activate').length).toBeGreaterThanOrEqual(2)
    expect(types.filter((type) => type === 'dag_sync').length).toBeGreaterThanOrEqual(2)
    expect(types).toContain('cursor_sync')
    expect(types).toContain('sorry_queue_refresh')
    expect(types).toContain('breakage_analyze')

    const panel = env.getPanel()
    expect(panel).toBeDefined()
    expect(panel.setState).toHaveBeenCalled()

    await extension.deactivate()
    expect(env.fakeApp.dispose).toHaveBeenCalledTimes(1)
  })

  it('handles toggle command by reveal-first then panel_set', async () => {
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
    expect(callTypes).toContain('panel_set')
  })

  it('returns world heads snapshot from command', async () => {
    const extension = await import('../packages/app/src/extension.ts')
    const context = { subscriptions: [] as Array<{ dispose: () => void }> }
    await extension.activate(context as any)

    const snapshotCommand = env.getCommand('proof-flow.worldHeadsSnapshot')
    expect(snapshotCommand).toBeTypeOf('function')

    const snapshot = await snapshotCommand?.()
    expect(snapshot).toMatchObject({
      current: {
        branchId: 'main',
        headWorldId: 'w_head',
        lineageLength: 2
      },
      stateSummary: {
        fileCount: 1,
        dagNodeCount: 1
      }
    })
  })

  it('dispatches node_select from panel action', async () => {
    const extension = await import('../packages/app/src/extension.ts')
    const context = { subscriptions: [] as Array<{ dispose: () => void }> }
    await extension.activate(context as any)

    const panel = env.getPanel() as { actions: { onNodeSelect: (nodeId: string) => Promise<void> } }
    await panel.actions.onNodeSelect('root')

    const nodeSelectCall = env.getActCalls().findLast((call) => call.type === 'node_select')
    expect(nodeSelectCall?.input).toMatchObject({ nodeId: 'root' })
  })
})
