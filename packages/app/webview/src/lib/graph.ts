import type { ProjectionNode } from '../../../src/projection-state.js'

type LayoutDirection = 'topDown' | 'leftRight'

export type GraphNode = {
  id: string
  label: string
  kind: ProjectionNode['kind']
  statusKind: ProjectionNode['statusKind']
  startLine: number
  endLine: number
  errorCategory: ProjectionNode['errorCategory']
  errorMessage: ProjectionNode['errorMessage']
  selected: boolean
  cursor: boolean
  x: number
  y: number
}

export type GraphEdge = {
  id: string
  source: string
  target: string
}

export type GraphLayoutResult = {
  compactMode: boolean
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const X_GAP = 280
const Y_GAP = 170
const LARGE_GRAPH_THRESHOLD = 220

const compareByPosition = (left: ProjectionNode, right: ProjectionNode): number => {
  if (left.startLine !== right.startLine) {
    return left.startLine - right.startLine
  }

  if (left.startCol !== right.startCol) {
    return left.startCol - right.startCol
  }

  return left.id.localeCompare(right.id)
}

const toLevelMap = (nodes: ProjectionNode[]): Map<string, number> => {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const indegree = new Map<string, number>()
  const children = new Map<string, string[]>()

  for (const node of nodes) {
    indegree.set(node.id, 0)
    children.set(node.id, [])
  }

  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      if (!nodeMap.has(dependency)) {
        continue
      }

      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1)
      const nextChildren = children.get(dependency) ?? []
      nextChildren.push(node.id)
      children.set(dependency, nextChildren)
    }
  }

  const queue = [...nodes]
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort(compareByPosition)
    .map((node) => node.id)

  const levels = new Map<string, number>()
  for (const node of nodes) {
    levels.set(node.id, 0)
  }

  let visited = 0
  while (queue.length > 0) {
    const currentId = queue.shift()
    if (!currentId) {
      break
    }

    visited += 1
    const currentLevel = levels.get(currentId) ?? 0
    for (const childId of children.get(currentId) ?? []) {
      const nextLevel = Math.max(levels.get(childId) ?? 0, currentLevel + 1)
      levels.set(childId, nextLevel)

      const nextInDegree = (indegree.get(childId) ?? 0) - 1
      indegree.set(childId, nextInDegree)
      if (nextInDegree === 0) {
        queue.push(childId)
      }
    }
  }

  if (visited !== nodes.length) {
    const sorted = [...nodes].sort(compareByPosition)
    for (const [index, node] of sorted.entries()) {
      levels.set(node.id, Math.floor(index / 3))
    }
  }

  return levels
}

const toPositionedNodes = (input: {
  nodes: ProjectionNode[]
  layout: LayoutDirection
  selectedNodeId: string | null
  cursorNodeId: string | null
}): GraphNode[] => {
  const levels = toLevelMap(input.nodes)
  const grouped = new Map<number, ProjectionNode[]>()

  for (const node of input.nodes) {
    const level = levels.get(node.id) ?? 0
    const group = grouped.get(level) ?? []
    group.push(node)
    grouped.set(level, group)
  }

  for (const group of grouped.values()) {
    group.sort(compareByPosition)
  }

  const nodes: GraphNode[] = []
  const sortedLevels = [...grouped.keys()].sort((left, right) => left - right)

  for (const level of sortedLevels) {
    const group = grouped.get(level) ?? []
    for (const [index, node] of group.entries()) {
      const x = input.layout === 'leftRight' ? level * X_GAP : index * X_GAP
      const y = input.layout === 'leftRight' ? index * Y_GAP : level * Y_GAP

      nodes.push({
        id: node.id,
        label: node.label,
        kind: node.kind,
        statusKind: node.statusKind,
        startLine: node.startLine,
        endLine: node.endLine,
        errorCategory: node.errorCategory,
        errorMessage: node.errorMessage,
        selected: node.id === input.selectedNodeId,
        cursor: node.id === input.cursorNodeId,
        x,
        y
      })
    }
  }

  return nodes
}

const toEdges = (nodes: ProjectionNode[]): GraphEdge[] => {
  const validIds = new Set(nodes.map((node) => node.id))
  const edges: GraphEdge[] = []

  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      if (!validIds.has(dependency)) {
        continue
      }

      edges.push({
        id: `${dependency}->${node.id}`,
        source: dependency,
        target: node.id
      })
    }
  }

  return edges
}

export const toGraphLayout = (input: {
  nodes: ProjectionNode[]
  layout: LayoutDirection
  selectedNodeId: string | null
  cursorNodeId: string | null
}): GraphLayoutResult => {
  const compactMode = input.nodes.length > LARGE_GRAPH_THRESHOLD

  if (compactMode) {
    return {
      compactMode,
      nodes: [],
      edges: []
    }
  }

  return {
    compactMode,
    nodes: toPositionedNodes(input),
    edges: toEdges(input.nodes)
  }
}

export const graphThreshold = LARGE_GRAPH_THRESHOLD
