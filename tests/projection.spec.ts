import { describe, expect, it } from 'vitest'
import type { AppState } from '@manifesto-ai/app'
import type { ProofFlowState } from '../packages/schema/src/index.js'
import { selectProjectionState } from '../packages/app/src/projection-state.js'

const baseData = (): ProofFlowState => ({
  appVersion: '0.1.0',
  files: {},
  ui: {
    panelVisible: true,
    activeFileUri: 'file:///proof.lean',
    selectedNodeId: 'child',
    cursorNodeId: 'root',
    layout: 'topDown',
    zoom: 1,
    collapseResolved: false
  },
  history: { version: '0.2.0', files: {} },
  patterns: { version: '0.3.0', entries: {}, totalAttempts: 0, updatedAt: null },
  suggestions: { version: '0.4.0', byNode: {}, updatedAt: null }
})

const makeState = (overrides?: Partial<AppState<unknown>>): AppState<unknown> => ({
  data: baseData(),
  computed: {},
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
  },
  ...(overrides ?? {})
})

describe('Projection selector', () => {
  it('projects active dag and sorts nodes by source position', () => {
    const state = makeState({
      data: {
        ...baseData(),
        history: {
          version: '0.2.0',
          files: {
            'file:///proof.lean': {
              fileUri: 'file:///proof.lean',
              nodes: {
                child: {
                  nodeId: 'child',
                  attempts: {
                    a1: {
                      id: 'a1',
                      fileUri: 'file:///proof.lean',
                      nodeId: 'child',
                      timestamp: 100,
                      tactic: 'simp',
                      tacticKey: 'simp',
                      result: 'error',
                      contextErrorCategory: 'OTHER',
                      errorMessage: 'oops',
                      durationMs: 10
                    },
                    a2: {
                      id: 'a2',
                      fileUri: 'file:///proof.lean',
                      nodeId: 'child',
                      timestamp: 120,
                      tactic: 'exact?',
                      tacticKey: 'exact',
                      result: 'success',
                      contextErrorCategory: 'OTHER',
                      errorMessage: null,
                      durationMs: 8
                    },
                    a3: {
                      id: 'a3',
                      fileUri: 'file:///proof.lean',
                      nodeId: 'child',
                      timestamp: 140,
                      tactic: 'aesop',
                      tacticKey: 'aesop',
                      result: 'error',
                      contextErrorCategory: 'OTHER',
                      errorMessage: 'still failing',
                      durationMs: 12
                    }
                  },
                  currentStreak: 2,
                  totalAttempts: 3,
                  lastAttemptAt: 140,
                  lastSuccessAt: 120,
                  lastFailureAt: 140
                }
              },
              totalAttempts: 3,
              updatedAt: 140
            }
          }
        },
        patterns: {
          version: '0.3.0',
          entries: {
            'OTHER:aesop': {
              key: 'OTHER:aesop',
              errorCategory: 'OTHER',
              tacticKey: 'aesop',
              successCount: 1,
              failureCount: 4,
              score: 0.2,
              lastUpdated: 140,
              dagFingerprint: null,
              dagClusterId: null,
              goalSignature: null
            },
            'OTHER:exact': {
              key: 'OTHER:exact',
              errorCategory: 'OTHER',
              tacticKey: 'exact',
              successCount: 2,
              failureCount: 1,
              score: 0.66,
              lastUpdated: 130,
              dagFingerprint: null,
              dagClusterId: null,
              goalSignature: null
            },
            'TACTIC_FAILED:simp': {
              key: 'TACTIC_FAILED:simp',
              errorCategory: 'TACTIC_FAILED',
              tacticKey: 'simp',
              successCount: 0,
              failureCount: 5,
              score: 0,
              lastUpdated: 120,
              dagFingerprint: null,
              dagClusterId: null,
              goalSignature: null
            }
          },
          totalAttempts: 8,
          updatedAt: 140
        },
        suggestions: {
          version: '0.4.0',
          byNode: {
            child: [
              {
                nodeId: 'child',
                tacticKey: 'exact',
                score: 0.8,
                sampleSize: 5,
                successRate: 0.8,
                sourceCategory: 'OTHER',
                generatedAt: 141
              },
              {
                nodeId: 'child',
                tacticKey: 'aesop',
                score: 0.2,
                sampleSize: 5,
                successRate: 0.2,
                sourceCategory: 'OTHER',
                generatedAt: 141
              }
            ]
          },
          updatedAt: 141
        }
      },
      computed: {
        'computed.activeDag': {
          fileUri: 'file:///proof.lean',
          rootIds: ['root'],
          extractedAt: 1,
          metrics: {
            totalNodes: 3,
            resolvedCount: 2,
            errorCount: 1,
            sorryCount: 0,
            inProgressCount: 0,
            maxDepth: 2
          },
          nodes: {
            child: {
              id: 'child',
              kind: 'have',
              label: 'child',
              leanRange: { startLine: 4, startCol: 4, endLine: 4, endCol: 20 },
              goal: null,
              status: { kind: 'error', errorMessage: 'oops', errorCategory: 'OTHER' },
              children: [],
              dependencies: ['root']
            },
            root: {
              id: 'root',
              kind: 'theorem',
              label: 'root',
              leanRange: { startLine: 1, startCol: 0, endLine: 1, endCol: 10 },
              goal: null,
              status: { kind: 'resolved', errorMessage: null, errorCategory: null },
              children: ['child'],
              dependencies: []
            },
            mid: {
              id: 'mid',
              kind: 'lemma',
              label: 'mid',
              leanRange: { startLine: 3, startCol: 2, endLine: 3, endCol: 18 },
              goal: null,
              status: { kind: 'resolved', errorMessage: null, errorCategory: null },
              children: [],
              dependencies: ['root']
            }
          }
        },
        'computed.summaryMetrics': {
          totalNodes: 3,
          resolvedCount: 2,
          errorCount: 1,
          sorryCount: 0,
          inProgressCount: 0,
          maxDepth: 2
        },
        'computed.selectedNode': {
          id: 'child',
          kind: 'have',
          label: 'child',
          leanRange: { startLine: 4, startCol: 4, endLine: 4, endCol: 20 },
          goal: null,
          status: { kind: 'error', errorMessage: 'oops', errorCategory: 'OTHER' },
          children: [],
          dependencies: ['root']
        }
      }
    })

    const projection = selectProjectionState(state)
    expect(projection.activeDag?.totalNodes).toBe(3)
    expect(projection.nodes.map((node) => node.id)).toEqual(['root', 'mid', 'child'])
    expect(projection.selectedNode?.id).toBe('child')
    expect(projection.summaryMetrics?.errorCount).toBe(1)
    expect(projection.attemptOverview.totalAttempts).toBe(8)
    expect(projection.attemptOverview.fileAttempts).toBe(3)
    expect(projection.attemptOverview.selectedNodeAttempts).toBe(3)
    expect(projection.nodeHeatmap.child).toEqual({
      attemptCount: 3,
      heatLevel: 'low'
    })
    expect(projection.nodes.find((node) => node.id === 'child')?.attemptCount).toBe(3)
    expect(projection.nodes.find((node) => node.id === 'root')?.heatLevel).toBe('none')
    expect(projection.selectedNodeHistory?.currentStreak).toBe(2)
    expect(projection.selectedNodeHistory?.lastResult).toBe('error')
    expect(projection.selectedNodeHistory?.recentAttempts[0]?.id).toBe('a3')
    expect(projection.dashboard).toMatchObject({
      totalPatterns: 3,
      qualifiedPatterns: 3
    })
    expect(projection.dashboard.errorCategoryTotals.OTHER).toBe(8)
    expect(projection.dashboard.errorCategoryTotals.TACTIC_FAILED).toBe(5)
    expect(projection.dashboard.topNodeAttempts[0]).toMatchObject({
      nodeId: 'child',
      totalAttempts: 3,
      currentStreak: 2,
      lastResult: 'error'
    })
    expect(projection.patternInsights.map((entry) => entry.key)).toEqual([
      'OTHER:exact',
      'OTHER:aesop'
    ])
    expect(projection.patternInsights[0]).toMatchObject({
      sampleSize: 3,
      successRate: 2 / 3
    })
    expect(projection.selectedNodeSuggestions.map((entry) => entry.tacticKey)).toEqual([
      'exact',
      'aesop'
    ])
    expect(projection.selectedNodeSuggestions[0]?.reason).toContain('category:OTHER')
    expect(projection.selectedNodeSuggestions[0]?.reason).toContain('sample:5')
    expect(projection.selectedNodeSuggestions[0]?.reason).toContain('node-local:')
    expect(projection.startHereQueue).toHaveLength(1)
    expect(projection.startHereQueue[0]).toMatchObject({
      nodeId: 'child',
      statusKind: 'error'
    })
  })

  it('returns safe null projection when computed dag is absent', () => {
    const projection = selectProjectionState(makeState())

    expect(projection.activeDag).toBeNull()
    expect(projection.summaryMetrics).toBeNull()
    expect(projection.attemptOverview).toEqual({
      totalAttempts: 0,
      fileAttempts: 0,
      selectedNodeAttempts: 0
    })
    expect(projection.nodeHeatmap).toEqual({})
    expect(projection.dashboard).toMatchObject({
      totalPatterns: 0,
      qualifiedPatterns: 0
    })
    expect(projection.nodes).toEqual([])
    expect(projection.selectedNode).toBeNull()
    expect(projection.selectedNodeHistory).toBeNull()
    expect(projection.patternInsights).toEqual([])
    expect(projection.selectedNodeSuggestions).toEqual([])
    expect(projection.startHereQueue).toEqual([])
  })

  it('builds start-here queue for long proofs with deterministic priority', () => {
    const longDagNodes: Record<string, any> = {}
    for (let index = 0; index < 25; index += 1) {
      const nodeId = `n${index}`
      const statusKind = index % 5 === 0
        ? 'sorry'
        : index % 3 === 0
          ? 'error'
          : 'resolved'
      longDagNodes[nodeId] = {
        id: nodeId,
        kind: 'have',
        label: nodeId,
        leanRange: {
          startLine: 10 + index,
          startCol: 0,
          endLine: 10 + index,
          endCol: 20
        },
        goal: null,
        status: {
          kind: statusKind,
          errorMessage: statusKind === 'resolved' ? null : 'pending',
          errorCategory: statusKind === 'error' ? 'TACTIC_FAILED' : statusKind === 'sorry' ? 'UNSOLVED_GOALS' : null
        },
        children: [],
        dependencies: []
      }
    }

    const historyNodes: Record<string, any> = {}
    for (let index = 0; index < 25; index += 1) {
      historyNodes[`n${index}`] = {
        nodeId: `n${index}`,
        attempts: {},
        currentStreak: 0,
        totalAttempts: index % 4,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null
      }
    }

    const projection = selectProjectionState(makeState({
      data: {
        ...baseData(),
        history: {
          version: '0.2.0',
          files: {
            'file:///proof.lean': {
              fileUri: 'file:///proof.lean',
              nodes: historyNodes,
              totalAttempts: 30,
              updatedAt: 1
            }
          }
        },
        ui: {
          ...baseData().ui,
          selectedNodeId: null,
          cursorNodeId: null
        }
      },
      computed: {
        'computed.activeDag': {
          fileUri: 'file:///proof.lean',
          rootIds: ['n0'],
          extractedAt: 1,
          metrics: {
            totalNodes: 25,
            resolvedCount: 13,
            errorCount: 7,
            sorryCount: 5,
            inProgressCount: 0,
            maxDepth: 2
          },
          nodes: longDagNodes
        },
        'computed.summaryMetrics': {
          totalNodes: 25,
          resolvedCount: 13,
          errorCount: 7,
          sorryCount: 5,
          inProgressCount: 0,
          maxDepth: 2
        },
        'computed.selectedNode': null
      }
    }))

    expect(projection.startHereQueue.length).toBeLessThanOrEqual(10)
    expect(projection.startHereQueue[0]?.statusKind).toBe('sorry')
    expect(projection.startHereQueue.every((entry) => entry.statusKind !== 'resolved')).toBe(true)
    for (let index = 1; index < projection.startHereQueue.length; index += 1) {
      expect(projection.startHereQueue[index - 1]!.priority).toBeGreaterThanOrEqual(
        projection.startHereQueue[index]!.priority
      )
    }
  })
})
