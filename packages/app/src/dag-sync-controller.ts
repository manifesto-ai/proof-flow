export type DagSyncReason = 'startup' | 'activate' | 'save' | 'diagnostics' | 'apply'

export type ScheduleDagSyncOptions = {
  afterSync?: () => Promise<void>
  debounceMsOverride?: number
}

type DagSyncEntry = {
  timer: ReturnType<typeof setTimeout> | null
  running: boolean
  queued: boolean
  pendingReason: DagSyncReason
  waiters: Array<() => void>
  afterSyncTasks: Array<() => Promise<void>>
}

const DEFAULT_DEBOUNCE_BY_REASON: Record<DagSyncReason, number> = {
  startup: 0,
  activate: 60,
  save: 120,
  diagnostics: 220,
  apply: 0
}

export class DagSyncController {
  private readonly entries = new Map<string, DagSyncEntry>()

  constructor(
    private readonly runSync: (fileUri: string) => Promise<void>,
    private readonly debounceByReason: Record<DagSyncReason, number> = DEFAULT_DEBOUNCE_BY_REASON
  ) {}

  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
      }

      this.flushWaiters(entry)
    }

    this.entries.clear()
  }

  schedule(
    fileUri: string,
    reason: DagSyncReason,
    options: ScheduleDagSyncOptions = {}
  ): Promise<void> {
    const entry = this.getOrCreateEntry(fileUri)
    entry.pendingReason = reason

    if (options.afterSync) {
      entry.afterSyncTasks.push(options.afterSync)
    }

    const promise = new Promise<void>((resolve) => {
      entry.waiters.push(resolve)
    })

    if (entry.running) {
      entry.queued = true
      return promise
    }

    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }

    const delay = Math.max(0, options.debounceMsOverride ?? this.debounceByReason[reason])
    entry.timer = setTimeout(() => {
      entry.timer = null
      void this.runEntry(fileUri)
    }, delay)

    return promise
  }

  private getOrCreateEntry(fileUri: string): DagSyncEntry {
    const existing = this.entries.get(fileUri)
    if (existing) {
      return existing
    }

    const created: DagSyncEntry = {
      timer: null,
      running: false,
      queued: false,
      pendingReason: 'diagnostics',
      waiters: [],
      afterSyncTasks: []
    }
    this.entries.set(fileUri, created)
    return created
  }

  private flushWaiters(entry: DagSyncEntry): void {
    const waiters = entry.waiters.splice(0)
    for (const resolve of waiters) {
      resolve()
    }
  }

  private async runEntry(fileUri: string): Promise<void> {
    const entry = this.entries.get(fileUri)
    if (!entry) {
      return
    }

    if (entry.running) {
      entry.queued = true
      return
    }

    entry.running = true
    const waiters = entry.waiters.splice(0)
    const tasks = entry.afterSyncTasks.splice(0)
    const queuedReason = entry.pendingReason

    await this.runSync(fileUri)

    for (const task of tasks) {
      try {
        await task()
      }
      catch {
        // best-effort post-sync hooks
      }
    }

    for (const resolve of waiters) {
      resolve()
    }

    entry.running = false

    if (entry.queued || entry.waiters.length > 0 || entry.afterSyncTasks.length > 0) {
      entry.queued = false
      const delay = this.debounceByReason[queuedReason] ?? this.debounceByReason.diagnostics
      entry.timer = setTimeout(() => {
        entry.timer = null
        void this.runEntry(fileUri)
      }, delay)
    }
  }
}
