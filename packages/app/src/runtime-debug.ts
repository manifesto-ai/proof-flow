import type { App } from '@manifesto-ai/app'
import type { ProjectionRuntimeDebug } from './projection-state.js'

export const resolveRuntimeDebug = (runtimeApp: App | null): ProjectionRuntimeDebug => {
  if (!runtimeApp) {
    return {
      world: {
        headWorldId: null,
        depth: null,
        branchId: null
      }
    }
  }

  try {
    const currentBranch = (runtimeApp as unknown as {
      currentBranch?: () => {
        id?: string
        head?: () => string
        lineage?: (opts?: { limit?: number }) => readonly string[]
      }
    }).currentBranch?.()

    const lineage = currentBranch?.lineage?.({ limit: 1024 }) ?? []
    const headFromGetter = (runtimeApp as unknown as { getCurrentHead?: () => string }).getCurrentHead?.()

    return {
      world: {
        headWorldId: headFromGetter ?? currentBranch?.head?.() ?? null,
        depth: lineage.length,
        branchId: currentBranch?.id ?? null
      }
    }
  }
  catch {
    return {
      world: {
        headWorldId: null,
        depth: null,
        branchId: null
      }
    }
  }
}
