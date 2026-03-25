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
  const dispatchCalls: Array<{ type: string; input: unknown; sourceKind: string }> = []
  const runtimeListeners = new Set<(snapshot: unknown) => void>()

  const leanUri = makeUri('file:///active.lean')

  const fakeSnapshot: any = {
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

  const fakeRuntime = {
    getSnapshot: vi.fn(() => fakeSnapshot),
    subscribe: vi.fn((listener: (snapshot: unknown) => void) => {
      runtimeListeners.add(listener)
      return () => {
        runtimeListeners.delete(listener)
      }
    }),
    dispatch: vi.fn(async (type: string, input?: unknown, sourceKind = 'ui') => {
      dispatchCalls.push({ type, input, sourceKind })

      if (type === 'selectGoal') {
        fakeSnapshot.data.activeGoalId = (input as { goalId?: string | null })?.goalId ?? null
      }

      if (type === 'applyTactic') {
        const tactic = (input as { tactic?: string })?.tactic ?? 'simp'
        fakeSnapshot.data.lastTactic = tactic
        fakeSnapshot.data.tacticResult = {
          goalId: (input as { goalId?: string })?.goalId ?? 'g1',
          tactic,
          succeeded: tactic !== 'fail',
          newGoalIds: [],
          errorMessage: tactic === 'fail' ? 'simulated failure' : null
        }
      }

      if (type === 'commitTactic') {
        if (fakeSnapshot.data.tacticResult?.succeeded) {
          fakeSnapshot.data.goals.g1.status = 'resolved'
        }
        fakeSnapshot.data.tacticResult = null
      }

      if (type === 'dismissTactic') {
        fakeSnapshot.data.tacticResult = null
      }

      for (const listener of runtimeListeners) {
        listener(fakeSnapshot)
      }

      return fakeSnapshot
    }),
    lineageDiffReport: vi.fn(async () => ({
      measuredAt: '2026-03-25T00:00:00.000Z',
      branch: {
        branchId: 'main',
        branchName: 'main',
        headWorldId: 'w_head',
        lineageLength: 2
      },
      summary: {
        edges: 1,
        added: 0,
        removed: 0,
        statusChanged: 1
      },
      worldIds: ['w_prev', 'w_head'],
      diffs: [{
        fromWorldId: 'w_prev',
        toWorldId: 'w_head',
        fromCreatedAt: 1,
        toCreatedAt: 2,
        counts: {
          added: 0,
          removed: 0,
          statusChanged: 1
        },
        addedGoals: [],
        removedGoals: [],
        statusChanges: [{
          id: 'g1',
          fromStatus: 'open',
          toStatus: 'resolved',
          statement: '⊢ True'
        }],
        fromTacticResult: null,
        toTacticResult: {
          goalId: 'g1',
          tactic: 'exact True.intro',
          succeeded: true,
          newGoalIds: [],
          errorMessage: null
        }
      }]
    })),
    dispose: vi.fn(() => {
      runtimeListeners.clear()
    })
  }

  const createProofFlowRuntime = vi.fn(async () => fakeRuntime as any)

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

  const selectProjectionState = vi.fn((_snapshot: unknown, panelVisible: boolean) => ({
    ui: {
      panelVisible
    },
    activeFileUri: leanUri.toString(),
    goals: [{ id: 'g1', statement: '⊢ True', status: 'open' }],
    selectedGoal: fakeSnapshot.data.activeGoalId === 'g1'
      ? { id: 'g1', statement: '⊢ True', status: fakeSnapshot.data.goals.g1.status }
      : null,
    progress: {
      totalGoals: 1,
      resolvedGoals: fakeSnapshot.data.goals.g1.status === 'resolved' ? 1 : 0,
      openGoals: fakeSnapshot.data.goals.g1.status === 'open' ? 1 : 0,
      failedGoals: 0,
      ratio: fakeSnapshot.data.goals.g1.status === 'resolved' ? 1 : 0
    },
    isComplete: fakeSnapshot.data.goals.g1.status === 'resolved',
    isTacticPending: false,
    lastTactic: fakeSnapshot.data.lastTactic,
    tacticResult: fakeSnapshot.data.tacticResult,
    nodes: [],
    diagnostics: []
  }))

  const createVscodeProofFlowEffects = vi.fn(() => ({
    'lean.syncGoals': async () => [],
    'lean.applyTactic': async () => []
  }))

  return {
    vscodeMock,
    createProofFlowRuntime,
    createVscodeProofFlowEffects,
    ProjectionPanelController,
    selectProjectionState,
    leanUri,
    listeners,
    commands,
    panelInstances,
    dispatchCalls,
    fakeRuntime,
    reset: () => {
      listeners.editor.length = 0
      listeners.save.length = 0
      listeners.diagnostics.length = 0
      commands.clear()
      panelInstances.length = 0
      dispatchCalls.length = 0
      runtimeListeners.clear()
      fakeSnapshot.data.activeGoalId = null
      fakeSnapshot.data.goals.g1.status = 'open'
      fakeSnapshot.data.lastTactic = null
      fakeSnapshot.data.tacticResult = null
      createProofFlowRuntime.mockClear()
      createVscodeProofFlowEffects.mockClear()
      selectProjectionState.mockClear()
      fakeRuntime.getSnapshot.mockClear()
      fakeRuntime.subscribe.mockClear()
      fakeRuntime.dispatch.mockClear()
      fakeRuntime.lineageDiffReport.mockClear()
      fakeRuntime.dispose.mockClear()
    },
    getCommand: (id: string) => commands.get(id),
    getPanel: () => panelInstances.at(-1),
    getDispatchCalls: () => [...dispatchCalls],
    getSnapshot: () => fakeSnapshot
  }
})

vi.mock('vscode', () => env.vscodeMock)
vi.mock('../packages/app/src/runtime.js', () => ({
  createProofFlowRuntime: env.createProofFlowRuntime
}))
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

describe('Extension E2E flow (super hard-cut)', () => {
  beforeEach(async () => {
    env.reset()
    const mod = await import('../packages/app/src/extension.js')
    await mod.activate({
      extensionUri: env.vscodeMock.Uri.parse('file:///extension'),
      subscriptions: []
    } as any)
  })

  it('runs startup syncGoals and syncs on editor/save/diagnostics events', async () => {
    expect(env.getDispatchCalls().map((call) => call.type)).toContain('syncGoals')

    await env.listeners.save[0]?.({ languageId: 'lean', uri: env.leanUri })
    await env.listeners.editor[0]?.({ document: { languageId: 'lean', uri: env.leanUri } })
    await env.listeners.diagnostics[0]?.({ uris: [env.leanUri] })

    const syncCalls = env.getDispatchCalls().filter((call) => call.type === 'syncGoals')
    expect(syncCalls.length).toBeGreaterThanOrEqual(4)
    expect(syncCalls.every((call) => call.sourceKind === 'system')).toBe(true)
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

  it('returns lineage diff report from runtime world lineage', async () => {
    const command = env.getCommand('proof-flow.lineageDiffReport')
    const report = await command?.({ limit: 8 })

    expect(env.fakeRuntime.lineageDiffReport).toHaveBeenCalledWith(8)
    expect(report.summary).toMatchObject({
      edges: 1,
      statusChanged: 1
    })
    expect(report.diffs[0]?.statusChanges[0]?.toStatus).toBe('resolved')
  })

  it('dispatches panel actions into runtime.dispatch', async () => {
    const panel = env.getPanel()
    await panel?.actions.onSelectGoal('g1')
    await panel?.actions.onApplyTactic('g1', 'simp')
    await panel?.actions.onCommitTactic()
    await panel?.actions.onDismissTactic()

    const types = env.getDispatchCalls().map((call) => call.type)
    expect(types).toContain('selectGoal')
    expect(types).toContain('applyTactic')
    expect(types).toContain('commitTactic')
    expect(types).toContain('dismissTactic')
    expect(env.getDispatchCalls().every((call) => call.sourceKind === 'ui' || call.type === 'syncGoals')).toBe(true)
  })

  it('dispatches dismiss for failed tactic result', async () => {
    const panel = env.getPanel()
    await panel?.actions.onApplyTactic('g1', 'fail')
    expect(env.getSnapshot().data.tacticResult?.succeeded).toBe(false)
    expect(env.getSnapshot().data.tacticResult?.errorMessage).toBe('simulated failure')

    await panel?.actions.onDismissTactic()
    expect(env.getSnapshot().data.tacticResult).toBeNull()
  })
})
