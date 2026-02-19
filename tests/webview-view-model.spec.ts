import { describe, expect, it } from 'vitest'
import {
  computeVisibleNodes,
  DEFAULT_STATUS_FILTER,
  toCompactPriorityNodes
} from '../packages/app/webview/src/lib/view-model'

const nodes = [
  {
    id: 'root',
    label: 'Root theorem',
    kind: 'theorem' as const,
    statusKind: 'resolved' as const,
    errorMessage: null,
    errorCategory: null,
    startLine: 1,
    endLine: 2,
    startCol: 0,
    endCol: 10,
    children: ['child'],
    dependencies: [],
    goalCurrent: null
  },
  {
    id: 'child',
    label: 'child goal',
    kind: 'have' as const,
    statusKind: 'error' as const,
    errorMessage: 'type mismatch',
    errorCategory: 'TYPE_MISMATCH' as const,
    startLine: 5,
    endLine: 6,
    startCol: 0,
    endCol: 12,
    children: [],
    dependencies: ['root'],
    goalCurrent: '⊢ Nat = Bool'
  },
  {
    id: 'todo',
    label: 'todo proof',
    kind: 'sorry' as const,
    statusKind: 'sorry' as const,
    errorMessage: null,
    errorCategory: 'UNSOLVED_GOALS' as const,
    startLine: 8,
    endLine: 9,
    startCol: 0,
    endCol: 12,
    children: [],
    dependencies: [],
    goalCurrent: '⊢ True'
  }
]

describe('webview view model', () => {
  it('filters by query/status/collapse and keeps deterministic sort', () => {
    const visible = computeVisibleNodes({
      nodes,
      query: 'type mismatch',
      statusFilter: DEFAULT_STATUS_FILTER,
      sortKey: 'position',
      hideResolved: false
    })

    expect(visible.map((node) => node.id)).toEqual(['child'])

    const collapsed = computeVisibleNodes({
      nodes,
      query: '',
      statusFilter: DEFAULT_STATUS_FILTER,
      sortKey: 'position',
      hideResolved: true
    })

    expect(collapsed.map((node) => node.id)).toEqual(['child', 'todo'])

    const statusSorted = computeVisibleNodes({
      nodes,
      query: '',
      statusFilter: DEFAULT_STATUS_FILTER,
      sortKey: 'status',
      hideResolved: false
    })

    expect(statusSorted.map((node) => node.id)).toEqual(['child', 'todo', 'root'])
  })

  it('builds compact priority list by status', () => {
    const compact = toCompactPriorityNodes(nodes, 2)
    expect(compact.map((node) => node.id)).toEqual(['child', 'todo'])
  })
})
