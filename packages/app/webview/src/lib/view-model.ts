import type { ProjectionNode } from '../../../src/projection-state.js'

export type NodeSortKey = 'position' | 'status' | 'label'

export type NodeStatusFilter = {
  error: boolean
  sorry: boolean
  in_progress: boolean
  resolved: boolean
}

export const DEFAULT_STATUS_FILTER: NodeStatusFilter = {
  error: true,
  sorry: true,
  in_progress: true,
  resolved: true
}

const STATUS_ORDER: Record<ProjectionNode['statusKind'], number> = {
  error: 0,
  sorry: 1,
  in_progress: 2,
  resolved: 3
}

const compareByPosition = (left: ProjectionNode, right: ProjectionNode): number => {
  if (left.startLine !== right.startLine) {
    return left.startLine - right.startLine
  }

  if (left.startCol !== right.startCol) {
    return left.startCol - right.startCol
  }

  return left.id.localeCompare(right.id)
}

const compareByStatus = (left: ProjectionNode, right: ProjectionNode): number => {
  const leftRank = STATUS_ORDER[left.statusKind] ?? Number.POSITIVE_INFINITY
  const rightRank = STATUS_ORDER[right.statusKind] ?? Number.POSITIVE_INFINITY
  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  return compareByPosition(left, right)
}

const compareByLabel = (left: ProjectionNode, right: ProjectionNode): number => {
  const leftLabel = (left.label || left.id).toLowerCase()
  const rightLabel = (right.label || right.id).toLowerCase()
  const labelComparison = leftLabel.localeCompare(rightLabel)
  if (labelComparison !== 0) {
    return labelComparison
  }

  return compareByPosition(left, right)
}

const sortNodes = (nodes: ProjectionNode[], sortKey: NodeSortKey): ProjectionNode[] => {
  const sorted = [...nodes]
  if (sortKey === 'status') {
    sorted.sort(compareByStatus)
    return sorted
  }

  if (sortKey === 'label') {
    sorted.sort(compareByLabel)
    return sorted
  }

  sorted.sort(compareByPosition)
  return sorted
}

export const computeVisibleNodes = (input: {
  nodes: ProjectionNode[]
  query: string
  statusFilter: NodeStatusFilter
  sortKey: NodeSortKey
  hideResolved: boolean
}): ProjectionNode[] => {
  const normalizedQuery = input.query.trim().toLowerCase()

  let filtered = [...input.nodes]

  if (input.hideResolved) {
    filtered = filtered.filter((node) => node.statusKind !== 'resolved')
  }

  filtered = filtered.filter((node) => input.statusFilter[node.statusKind])

  if (normalizedQuery.length > 0) {
    filtered = filtered.filter((node) => {
      const haystack = [
        node.id,
        node.label,
        node.kind,
        node.errorCategory ?? '',
        node.errorMessage ?? '',
        node.goalCurrent ?? ''
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }

  return sortNodes(filtered, input.sortKey)
}

export const toCompactPriorityNodes = (
  nodes: ProjectionNode[],
  limit: number
): ProjectionNode[] => {
  const ranked = [...nodes].sort((left, right) => {
    const leftStatus = STATUS_ORDER[left.statusKind] ?? 99
    const rightStatus = STATUS_ORDER[right.statusKind] ?? 99
    if (leftStatus !== rightStatus) {
      return leftStatus - rightStatus
    }

    return compareByPosition(left, right)
  })

  return ranked.slice(0, limit)
}
