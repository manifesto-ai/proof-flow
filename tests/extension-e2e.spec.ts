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

  const listeners = {
    editor: [] as Array<(editor: unknown) => unknown>,
    save: [] as Array<(document: unknown) => unknown>,
    diagnostics: [] as Array<(event: unknown) => unknown>
  }

  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const panelInstances: Array<{ actions: any; instance: any }> = []
  const actCalls: Array<{ type: string; input: unknown }> = []

  const leanUri = makeUri('file:///active.lean')

  const fakeState: any = {
    data: {
      goals: {
        g1: { id: 'g1', statement: '⊢ True', status: 'open' }
      },
      activeGoalId: null,
      lastTactic: null,
      tacticResult: null,
      applyingTactic: null,
      resolvingGoal: null,
      syncingGoals: null,
      $host: {
        leanState: {
          fileUri: leanUri.toString(),
          dag: {
            nodes: {
              root: {
                nodeId: 'root',
                label: leanUri.toString(),
                kind: 'definition',
                startLine: 1,
                endLine: 10,
                parentId: null,
                status: 'in_progress',
                errorMessage: null,
                errorCategory: null,
                goalId: null
              },
              n1: {
                nodeId: 'n1',
                label: 'theorem t : True := by',
                kind: 'theorem',
                startLine: 2,
                endLine: 4,
                parentId: 'root',
                status: 'sorry',
                errorMessage: null,
                errorCategory: null,
                goalId: 'g1'
              }
            },
            edges: [{ source: 'root', target: 'n1' }]
          },
          goalPositions: {
            g1: {
              startLine: 3,
              startCol: 2,
              endLine: 3,
              endCol: 7
            }
          },
          diagnostics: [],
          lastElaboratedAt: 1
        }
      }
    },
    computed: {
      'computed.isTacticPending': false
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

  const fakeSnapshots: Record<string, unknown> = {
    w_prev: {
      data: {
        goals: {
          g1: { id: 'g1', statement: '⊢ True', status: 'open' }
        },
        tacticResult: null
      }
    },
    w_head: {
      data: {
        goals: {
          g1: { id: 'g1', statement: '⊢ True', status: 'resolved' }
        },
        tacticResult: {
          goalId: 'g1',
          tactic: 'exact True.intro',
          succeeded: true,
          newGoalIds: [],
          errorMessage: null
        }
      }
    }
  }

  const fakeWorlds: Record<string, { createdAt: number }> = {
    w_prev: { createdAt: 1 },
    w_head: { createdAt: 2 }
  }

  const fakeApp = {
    ready: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    act: vi.fn((type: string, input?: unknown) => {
      actCalls.push({ type, input })
      if (type === 'selectGoal') {
        fakeState.data.activeGoalId = (input as { goalId?: string | null })?.goalId ?? null
      }
      if (type === 'applyTactic') {
        const tactic = (input as { tactic?: string })?.tactic ?? 'simp'
        fakeState.data.tacticResult = {
          goalId: (input as { goalId?: string })?.goalId ?? 'g1',
          tactic,
          succeeded: tactic !== 'fail',
          newGoalIds: [],
          errorMessage: tactic === 'fail' ? 'simulated failure' : null
        }
      }
      if (type === 'commitTactic') {
        if (fakeState.data.tacticResult?.succeeded) {
          fakeState.data.goals.g1.status = 'resolved'
        }
        fakeState.data.tacticResult = null
      }
      if (type === 'dismissTactic') {
        fakeState.data.tacticResult = null
      }
      return { done: async () => {} }
    }),
    getState: vi.fn(() => fakeState),
    subscribe: vi.fn((selector: (state: unknown) => unknown, listener: (selected: unknown) => void) => {
      listener(selector(fakeState))
      return () => {}
    }),
    currentBranch: vi.fn(() => ({
      id: 'main',
      name: 'main',
      head: () => 'w_head',
      lineage: () => ['w_head', 'w_prev']
    })),
    getCurrentHead: vi.fn(() => 'w_head'),
    getWorld: vi.fn(async (worldId: string) => ({
      worldId,
      createdAt: fakeWorlds[worldId]?.createdAt ?? 0
    })),
    getSnapshot: vi.fn(async (worldId: string) => fakeSnapshots[worldId] ?? null)
  }

  const createProofFlowApp = vi.fn(() => fakeApp as any)

  const window = {
    activeTextEditor: {
      document: {
        languageId: 'lean',
        uri: leanUri,
        getText: () => 'theorem t : True := by\n  sorry\n'
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
    showWarningMessage: vi.fn(async () => undefined),
    showErrorMessage: vi.fn(async () => undefined)
  }

  const workspace = {
    workspaceFolders: [{ uri: makeUri('file:///workspace') }],
    getConfiguration: vi.fn(() => ({ get: vi.fn(() => '') })),
    fs: {
      readFile: vi.fn(async () => new TextEncoder().encode('domain ProofFlow { state { x: number = 1 } }'))
    },
    openTextDocument: vi.fn(async () => ({
      uri: leanUri,
      languageId: 'lean',
      getText: () => 'theorem t : True := by\n  sorry\n'
    })),
    onDidSaveTextDocument: (cb: (document: unknown) => unknown) => {
      listeners.save.push(cb)
      return new Disposable()
    }
  }

  const languages = {
    onDidChangeDiagnostics: (cb: (event: unknown) => unknown) => {
      listeners.diagnostics.push(cb)
      return new Disposable()
    },
    getDiagnostics: vi.fn(() => [])
  }

  const commandsApi = {
    registerCommand: vi.fn((id: string, handler: (...args: unknown[]) => unknown) => {
      commands.set(id, handler)
      return new Disposable()
    })
  }

  const vscodeMock = {
    window,
    workspace,
    languages,
    commands: commandsApi,
    extensions: {
      all: [],
      getExtension: vi.fn(() => undefined)
    },
    Uri: {
      parse: (value: string) => makeUri(value),
      file: (value: string) => makeUri(`file://${value}`),
      joinPath: (base: { toString: () => string }, ...parts: string[]) => makeUri(`${base.toString().replace(/\/$/, '')}/${parts.join('/')}`)
    },
    ViewColumn: { Beside: 2 },
    Disposable
  }

  class ProjectionPanelController {
    private open = false
    readonly setState = vi.fn()
    readonly reveal = vi.fn(() => {
      this.open = true
    })

    constructor(
      _context: unknown,
      readonly actions: {
        onSelectGoal: (goalId: string | null) => Promise<void>
        onApplyTactic: (goalId: string, tactic: string) => Promise<void>
        onCommitTactic: () => Promise<void>
        onDismissTactic: () => Promise<void>
        onTogglePanel: () => Promise<void>
      }
    ) {
      panelInstances.push({ actions, instance: this })
    }

    isOpen(): boolean {
      return this.open
    }

    dispose(): void {
      this.open = false
    }
  }

  const selectProjectionState = vi.fn((_state: unknown, panelVisible: boolean) => ({
    ui: {
      panelVisible
    },
    activeFileUri: leanUri.toString(),
    goals: [{ id: 'g1', statement: '⊢ True', status: 'open' }],
    selectedGoal: null,
    progress: {
      totalGoals: 1,
      resolvedGoals: 0,
      openGoals: 1,
      failedGoals: 0,
      ratio: 0
    },
    isComplete: false,
    isTacticPending: false,
    lastTactic: null,
    tacticResult: null,
    nodes: [],
    diagnostics: []
  }))

  const createVscodeProofFlowEffects = vi.fn(() => ({
    'lean.syncGoals': async () => [],
    'lean.applyTactic': async () => []
  }))

  return {
    vscodeMock,
    createProofFlowApp,
    createVscodeProofFlowEffects,
    ProjectionPanelController,
    selectProjectionState,
    leanUri,
    listeners,
    commands,
    panelInstances,
    actCalls,
    fakeApp,
    reset: () => {
      listeners.editor.length = 0
      listeners.save.length = 0
      listeners.diagnostics.length = 0
      commands.clear()
      panelInstances.length = 0
      actCalls.length = 0
      fakeState.data.activeGoalId = null
      fakeState.data.goals.g1.status = 'open'
      fakeState.data.tacticResult = null
      createProofFlowApp.mockClear()
      createVscodeProofFlowEffects.mockClear()
      selectProjectionState.mockClear()
      fakeApp.ready.mockClear()
      fakeApp.dispose.mockClear()
      fakeApp.act.mockClear()
      fakeApp.getState.mockClear()
      fakeApp.subscribe.mockClear()
      fakeApp.currentBranch.mockClear()
      fakeApp.getWorld.mockClear()
      fakeApp.getSnapshot.mockClear()
    },
    getCommand: (id: string) => commands.get(id),
    getPanel: () => panelInstances.at(-1),
    getActCalls: () => [...actCalls],
    getState: () => fakeState
  }
})

vi.mock('vscode', () => env.vscodeMock)
vi.mock('../packages/app/src/config.js', () => ({ createProofFlowApp: env.createProofFlowApp }))
vi.mock('../packages/app/src/effects-adapter.js', () => ({
  createVscodeProofFlowEffects: env.createVscodeProofFlowEffects,
  isLeanDocument: (document: { languageId?: string; uri?: { path?: string } }) => (
    document.languageId === 'lean' || document.uri?.path?.endsWith('.lean')
  ),
  isLeanUri: (uri: { path?: string }) => uri.path?.endsWith('.lean') ?? false
}))
vi.mock('../packages/app/src/webview-panel.js', () => ({
  ProjectionPanelController: env.ProjectionPanelController,
  selectProjectionState: env.selectProjectionState
}))

describe('Extension E2E flow (hard-cut)', () => {
  beforeEach(async () => {
    env.reset()
    const mod = await import('../packages/app/src/extension.js')
    await mod.activate({
      extensionUri: env.vscodeMock.Uri.parse('file:///extension'),
      subscriptions: []
    } as any)
  })

  it('runs startup syncGoals and syncs on editor/save/diagnostics events', async () => {
    expect(env.getActCalls().map((call) => call.type)).toContain('syncGoals')

    await env.listeners.save[0]?.({ languageId: 'lean', uri: env.leanUri })
    await env.listeners.editor[0]?.({ document: { languageId: 'lean', uri: env.leanUri } })
    await env.listeners.diagnostics[0]?.({ uris: [env.leanUri] })

    const syncCalls = env.getActCalls().filter((call) => call.type === 'syncGoals')
    expect(syncCalls.length).toBeGreaterThanOrEqual(4)
  })

  it('toggles panel visibility through command and reveal', async () => {
    const command = env.getCommand('proof-flow.hello')
    const panel = env.getPanel()?.instance
    expect(command).toBeTypeOf('function')

    await command?.()
    await command?.()

    expect(panel.reveal).toHaveBeenCalledTimes(1)
    const lastSetState = panel.setState.mock.calls.at(-1)?.[0]
    expect(lastSetState?.ui.panelVisible).toBe(true)
  })

  it('returns lineage diff report based on goal status transitions', async () => {
    const command = env.getCommand('proof-flow.lineageDiffReport')
    const report = await command?.({ limit: 8 })

    expect(report.summary).toMatchObject({
      edges: 1,
      statusChanged: 1
    })
    expect(report.diffs[0]?.statusChanges[0]?.toStatus).toBe('resolved')
  })

  it('dispatches panel actions into app.act', async () => {
    const panel = env.getPanel()
    await panel?.actions.onSelectGoal('g1')
    await panel?.actions.onApplyTactic('g1', 'simp')
    await panel?.actions.onCommitTactic()
    await panel?.actions.onDismissTactic()

    const types = env.getActCalls().map((call) => call.type)
    expect(types).toContain('selectGoal')
    expect(types).toContain('applyTactic')
    expect(types).toContain('commitTactic')
    expect(types).toContain('dismissTactic')
  })

  it('dispatches dismiss for failed tactic result', async () => {
    const panel = env.getPanel()
    await panel?.actions.onApplyTactic('g1', 'fail')
    expect(env.getState().data.tacticResult?.succeeded).toBe(false)
    expect(env.getState().data.tacticResult?.errorMessage).toBe('simulated failure')

    await panel?.actions.onDismissTactic()
    expect(env.getState().data.tacticResult).toBeNull()
  })
})
