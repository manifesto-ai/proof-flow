const GOAL_SIGNATURE_MAX_LENGTH = 240

export const toGoalSignature = (goalText: unknown): string | null => {
  if (typeof goalText !== 'string') {
    return null
  }

  const trimmed = goalText.trim()
  if (trimmed.length === 0) {
    return null
  }

  const canonical = trimmed
    .replace(/^⊢\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (canonical.length === 0) {
    return null
  }

  return canonical.length > GOAL_SIGNATURE_MAX_LENGTH
    ? canonical.slice(0, GOAL_SIGNATURE_MAX_LENGTH)
    : canonical
}
