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
  patterns: { version: '0.3.0', entries: {}, totalAttempts: 0, updatedAt: null }
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
  })

  it('returns safe null projection when computed dag is absent', () => {
    const projection = selectProjectionState(makeState())

    expect(projection.activeDag).toBeNull()
    expect(projection.summaryMetrics).toBeNull()
    expect(projection.nodes).toEqual([])
    expect(projection.selectedNode).toBeNull()
  })
})
