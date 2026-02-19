import { describe, expect, it } from 'vitest'
import { toGraphLayout } from '../packages/app/webview/src/lib/graph'

const makeNode = (input: {
  id: string
  dependencies?: string[]
  statusKind?: 'resolved' | 'error' | 'sorry' | 'in_progress'
  startLine: number
}) => ({
  id: input.id,
  label: input.id,
  kind: 'have' as const,
  statusKind: input.statusKind ?? 'resolved',
  errorMessage: null,
  errorCategory: null,
  startLine: input.startLine,
  endLine: input.startLine,
  startCol: 0,
  endCol: 10,
  children: [],
  dependencies: input.dependencies ?? [],
  goalCurrent: null
})

describe('webview graph layout', () => {
  it('creates dependency edges from dependency -> node', () => {
    const nodes = [
      makeNode({ id: 'root', startLine: 1 }),
      makeNode({ id: 'child', dependencies: ['root'], startLine: 2 }),
      makeNode({ id: 'grandChild', dependencies: ['child'], startLine: 3 })
    ]

    const graph = toGraphLayout({
      nodes,
      layout: 'topDown',
      selectedNodeId: 'child',
      cursorNodeId: 'grandChild'
    })

    expect(graph.compactMode).toBe(false)
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['root', 'child'],
      ['child', 'grandChild']
    ])

    const selected = graph.nodes.find((node) => node.id === 'child')
    const cursor = graph.nodes.find((node) => node.id === 'grandChild')
    expect(selected?.selected).toBe(true)
    expect(cursor?.cursor).toBe(true)
  })

  it('switches to compact mode for large dag', () => {
    const nodes = Array.from({ length: 230 }, (_, index) => makeNode({
      id: `n${index}`,
      startLine: index + 1,
      statusKind: index % 5 === 0 ? 'error' : 'resolved'
    }))

    const graph = toGraphLayout({
      nodes,
      layout: 'leftRight',
      selectedNodeId: null,
      cursorNodeId: null
    })

    expect(graph.compactMode).toBe(true)
    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
  })
})
