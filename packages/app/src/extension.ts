import path from 'node:path'
import * as vscode from 'vscode'
import type { App, Effects } from '@manifesto-ai/app'
import type {
  AttemptResult,
  ProofFlowState,
  Range,
  StatusKind
} from '@proof-flow/schema'
import {
  createProofFlowEffects,
  resolveNodeIdAtCursor,
  type LeanDiagnostic,
  type LeanGoalHint,
  type LeanDiagnosticSeverity
} from '@proof-flow/host'
import { createProofFlowApp } from './config.js'
import { createProofFlowWorld } from './worldstore.js'
import {
  ProjectionPanelController,
  selectProjectionState
} from './webview-panel.js'

let app: App | null = null
let panelController: ProjectionPanelController | null = null
const attemptFingerprints = new Map<string, string>()

const isLeanDocument = (document: vscode.TextDocument): boolean => (
  document.languageId === 'lean'
  || document.uri.path.endsWith('.lean')
)

const isLeanUri = (uri: vscode.Uri): boolean => uri.path.endsWith('.lean')

const LEAN_GOAL_COMMAND_CANDIDATES = [
  'lean4.infoview.api.getGoals',
  'lean4.infoview.getGoals',
  'lean4.getGoals',
  'lean4.goalState',
  'lean4.goals'
] as const

const LEAN_STABLE_GOAL_METHODS = [
  '$/lean/plainGoal',
  '$/lean/plainTermGoal'
] as const

type GoalSourceStats = {
  stableHints: number
  diagnosticHints: number
  hoverHints: number
  apiHints: number
  commandHints: number
  stableMethodsUsed: string[]
  apiMethodsUsed: string[]
  commandsUsed: string[]
}

const goalSourceStatsByFileUri = new Map<string, GoalSourceStats>()

let cachedGoalCommands: string[] | undefined
const cachedLeanExtensionApiMethods = new Map<string, (...args: unknown[]) => unknown>()
let cachedLeanClientProvider: Record<string, unknown> | undefined
let lastLeanClientProviderMissAt = 0

const LEAN_EXTENSION_IDS = [
  'leanprover.lean4'
] as const

const LEAN_API_METHOD_PATHS = [
  'getGoals',
  'api.getGoals',
  'infoviewApi.getGoals',
  'infoview.getGoals'
] as const

const LEAN_FEATURE_TIMEOUT_MS = 1000
const LEAN_PROVIDER_RETRY_COOLDOWN_MS = 2000

const toVscodeRange = (range: Range): vscode.Range => {
  const startLine = Math.max(range.startLine - 1, 0)
  const endLine = Math.max(range.endLine - 1, startLine)
  const startCol = Math.max(range.startCol, 0)
  const endCol = Math.max(range.endCol, startCol)
  return new vscode.Range(startLine, startCol, endLine, endCol)
}

const normalizeDiagnosticCode = (
  code: vscode.Diagnostic['code']
): string | number | undefined => {
  if (typeof code === 'string' || typeof code === 'number') {
    return code
  }

  if (code && typeof code === 'object' && 'value' in code) {
    const value = code.value
    if (typeof value === 'string' || typeof value === 'number') {
      return value
    }
  }

  return undefined
}

const toLeanSeverity = (severity: vscode.DiagnosticSeverity): LeanDiagnosticSeverity => {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error: return 'error'
    case vscode.DiagnosticSeverity.Warning: return 'warning'
    case vscode.DiagnosticSeverity.Information: return 'information'
    case vscode.DiagnosticSeverity.Hint: return 'hint'
    default: return 'information'
  }
}

const toLeanDiagnostic = (diagnostic: vscode.Diagnostic): LeanDiagnostic => ({
  message: diagnostic.message,
  severity: toLeanSeverity(diagnostic.severity),
  source: diagnostic.source,
  code: normalizeDiagnosticCode(diagnostic.code),
  range: {
    startLine: diagnostic.range.start.line + 1,
    startCol: diagnostic.range.start.character,
    endLine: diagnostic.range.end.line + 1,
    endCol: diagnostic.range.end.character
  }
})

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const asRange = (value: unknown): Range | null => {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  // Native Lean-style payload shape
  if (
    typeof record.startLine === 'number'
    && typeof record.startCol === 'number'
    && typeof record.endLine === 'number'
    && typeof record.endCol === 'number'
  ) {
    return {
      startLine: record.startLine,
      startCol: record.startCol,
      endLine: record.endLine,
      endCol: record.endCol
    }
  }

  // VS Code range shape
  const start = asRecord(record.start)
  const end = asRecord(record.end)
  if (
    start
    && end
    && typeof start.line === 'number'
    && typeof start.character === 'number'
    && typeof end.line === 'number'
    && typeof end.character === 'number'
  ) {
    return {
      startLine: start.line + 1,
      startCol: start.character,
      endLine: end.line + 1,
      endCol: end.character
    }
  }

  return null
}

const asStringList = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
)

const normalizeFsPath = (value: string): string => {
  const normalized = path.normalize(value).replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const isPathInside = (candidatePath: string, folderPath: string): boolean => {
  const candidate = normalizeFsPath(candidatePath)
  const folder = normalizeFsPath(folderPath).replace(/\/+$/, '')
  return candidate === folder || candidate.startsWith(`${folder}/`)
}

const extractGoalLines = (message: string): string[] => message
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.includes('⊢') || line.toLowerCase().startsWith('goal:'))
  .map((line) => line.startsWith('goal:') ? line.slice(5).trim() : line)
  .filter((line) => line.length > 0)

const extractGoalHintsFromDiagnostics = (
  diagnostics: readonly vscode.Diagnostic[]
): LeanGoalHint[] => {
  const hints: LeanGoalHint[] = []
  for (const diagnostic of diagnostics) {
    const lines = extractGoalLines(diagnostic.message)
    for (const goal of lines) {
      hints.push({
        goal,
        range: {
          startLine: diagnostic.range.start.line + 1,
          startCol: diagnostic.range.start.character,
          endLine: diagnostic.range.end.line + 1,
          endCol: diagnostic.range.end.character
        },
        source: 'diagnostic'
      })
    }
  }

  return hints
}

const toHoverContentText = (content: vscode.MarkedString | vscode.MarkdownString): string => {
  if (typeof content === 'string') {
    return content
  }

  if ('value' in content && typeof content.value === 'string') {
    return content.value
  }

  const contentRecord = content as { value?: unknown }
  return typeof contentRecord.value === 'string' ? contentRecord.value : ''
}

const extractGoalHintsFromHoverProvider = async (
  uri: vscode.Uri,
  diagnostics: readonly vscode.Diagnostic[]
): Promise<LeanGoalHint[]> => {
  const commandsApi = vscode.commands as typeof vscode.commands & {
    executeCommand?: (command: string, ...args: unknown[]) => Thenable<unknown>
  }

  if (typeof commandsApi.executeCommand !== 'function') {
    return []
  }

  const hints: LeanGoalHint[] = []
  const seen = new Set<string>()

  for (const diagnostic of diagnostics.slice(0, 20)) {
    try {
      const position = new vscode.Position(
        diagnostic.range.start.line,
        diagnostic.range.start.character
      )
      const raw = await commandsApi.executeCommand(
        'vscode.executeHoverProvider',
        uri,
        position
      )
      const hovers = Array.isArray(raw) ? raw as vscode.Hover[] : []

      for (const hover of hovers) {
        const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents]
        for (const content of contents) {
          const text = toHoverContentText(content)
          const goals = extractGoalLines(text)
          for (const goal of goals) {
            const key = [
              goal,
              diagnostic.range.start.line,
              diagnostic.range.start.character,
              diagnostic.range.end.line,
              diagnostic.range.end.character
            ].join('|')
            if (seen.has(key)) {
              continue
            }

            seen.add(key)
            hints.push({
              goal,
              range: {
                startLine: diagnostic.range.start.line + 1,
                startCol: diagnostic.range.start.character,
                endLine: diagnostic.range.end.line + 1,
                endCol: diagnostic.range.end.character
              },
              source: 'hover'
            })
          }
        }
      }
    }
    catch {
      // Ignore per-position hover failures and continue with other hints.
    }
  }

  return hints
}

const normalizeGoalHints = (raw: unknown, source: string): LeanGoalHint[] => {
  const list = Array.isArray(raw)
    ? raw
    : (asRecord(raw)?.goals as unknown[] | undefined)

  if (!Array.isArray(list)) {
    return []
  }

  const hints: LeanGoalHint[] = []
  for (const item of list) {
    if (typeof item === 'string') {
      const goal = item.trim()
      if (goal.length > 0) {
        hints.push({ goal, source })
      }
      continue
    }

    const record = asRecord(item)
    if (!record) {
      continue
    }

    const goalCandidate = (
      typeof record.goal === 'string' ? record.goal
      : typeof record.type === 'string' ? record.type
      : typeof record.goalText === 'string' ? record.goalText
      : null
    )
    if (!goalCandidate || goalCandidate.trim().length === 0) {
      continue
    }

    const range = asRange(record.range)
    const nodeId = typeof record.nodeId === 'string' ? record.nodeId : undefined

    hints.push({
      goal: goalCandidate.trim(),
      range,
      nodeId,
      source
    })
  }

  return hints
}

const asFunction = (value: unknown): ((...args: unknown[]) => unknown) | null => (
  typeof value === 'function'
    ? value as (...args: unknown[]) => unknown
    : null
)

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | null> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    const timeout = new Promise<null>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(null), timeoutMs)
    })
    return await Promise.race([promise, timeout])
  }
  finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

const resolveNestedField = (root: unknown, path: string): unknown => {
  const steps = path.split('.')
  let current: unknown = root
  for (const step of steps) {
    const record = asRecord(current)
    if (!record || !(step in record)) {
      return null
    }
    current = record[step]
  }
  return current
}

type LeanClientLike = {
  sendRequest: (method: string, params: unknown) => Promise<unknown>
  getClientFolderPath: () => string | null
}

const toLeanClient = (candidate: unknown): LeanClientLike | null => {
  const record = asRecord(candidate)
  if (!record) {
    return null
  }

  const sendRequestFn = asFunction(record.sendRequest)
  if (!sendRequestFn) {
    return null
  }

  const getClientFolderPath = (): string | null => {
    const getClientFolderFn = asFunction(record.getClientFolder)
    if (!getClientFolderFn) {
      return null
    }

    try {
      const folder = getClientFolderFn.call(candidate)
      const folderRecord = asRecord(folder)
      if (!folderRecord) {
        return null
      }

      if (
        folderRecord.scheme === 'file'
        && typeof folderRecord.fsPath === 'string'
      ) {
        return folderRecord.fsPath
      }

      return null
    }
    catch {
      return null
    }
  }

  return {
    sendRequest: async (method, params) => Promise.resolve(sendRequestFn.call(candidate, method, params)),
    getClientFolderPath
  }
}

const toLeanFeatureProvider = (candidate: unknown): Record<string, unknown> | null => {
  const record = asRecord(candidate)
  if (!record) {
    return null
  }

  const clientProviderRecord = asRecord(record.clientProvider)
  if (!clientProviderRecord) {
    return null
  }

  return clientProviderRecord
}

const resolveLeanClientProvider = async (): Promise<Record<string, unknown> | null> => {
  if (cachedLeanClientProvider) {
    return cachedLeanClientProvider
  }

  if ((Date.now() - lastLeanClientProviderMissAt) < LEAN_PROVIDER_RETRY_COOLDOWN_MS) {
    return null
  }

  const extensionsApi = vscode.extensions as typeof vscode.extensions | undefined
  if (!extensionsApi) {
    lastLeanClientProviderMissAt = Date.now()
    return null
  }

  const extension = extensionsApi.getExtension('leanprover.lean4')
  if (!extension) {
    lastLeanClientProviderMissAt = Date.now()
    return null
  }

  const extensionExports = extension.isActive
    ? extension.exports
    : await extension.activate()
  const exportsRecord = asRecord(extensionExports)
  if (!exportsRecord) {
    lastLeanClientProviderMissAt = Date.now()
    return null
  }

  const directProvider = toLeanFeatureProvider(exportsRecord)
  if (directProvider) {
    cachedLeanClientProvider = directProvider
    return cachedLeanClientProvider
  }

  const allFeaturesFn = asFunction(exportsRecord.allFeatures)
  if (allFeaturesFn) {
    try {
      const allFeatures = await withTimeout(
        Promise.resolve(allFeaturesFn.call(extensionExports)),
        LEAN_FEATURE_TIMEOUT_MS
      )
      const providerFromAllFeatures = toLeanFeatureProvider(allFeatures)
      if (providerFromAllFeatures) {
        cachedLeanClientProvider = providerFromAllFeatures
        return cachedLeanClientProvider
      }
    }
    catch {
      // Keep trying fallback paths.
    }
  }

  const lean4EnabledFeatures = exportsRecord.lean4EnabledFeatures
  if (
    lean4EnabledFeatures
    && typeof (lean4EnabledFeatures as { then?: unknown }).then === 'function'
  ) {
    try {
      const resolvedFeatures = await withTimeout(
        Promise.resolve(lean4EnabledFeatures as Promise<unknown>),
        LEAN_FEATURE_TIMEOUT_MS
      )
      const providerFromLeanFeatures = toLeanFeatureProvider(resolvedFeatures)
      if (providerFromLeanFeatures) {
        cachedLeanClientProvider = providerFromLeanFeatures
        return cachedLeanClientProvider
      }
    }
    catch {
      // Keep trying fallback paths.
    }
  }

  lastLeanClientProviderMissAt = Date.now()
  return null
}

const pickBestLeanClient = (clients: LeanClientLike[], fileUri: string): LeanClientLike | null => {
  if (clients.length === 0) {
    return null
  }

  const uri = vscode.Uri.parse(fileUri)
  if (uri.scheme !== 'file') {
    return clients[0] ?? null
  }

  let best: { client: LeanClientLike; pathLength: number } | null = null
  for (const client of clients) {
    const folderPath = client.getClientFolderPath()
    if (!folderPath || !isPathInside(uri.fsPath, folderPath)) {
      continue
    }

    const pathLength = normalizeFsPath(folderPath).length
    if (!best || pathLength > best.pathLength) {
      best = { client, pathLength }
    }
  }

  return best?.client ?? clients[0] ?? null
}

const resolveLeanClient = async (fileUri: string): Promise<LeanClientLike | null> => {
  const provider = await resolveLeanClientProvider()
  if (!provider) {
    return null
  }

  const providerRecord = asRecord(provider)
  if (!providerRecord) {
    return null
  }

  const uri = vscode.Uri.parse(fileUri)
  const findClientFn = asFunction(providerRecord.findClient)
  if (findClientFn) {
    try {
      const extUriLike = uri.scheme === 'file'
        ? {
            scheme: 'file',
            fsPath: uri.fsPath,
            isInFolder: (folder: { fsPath?: string }) => (
              typeof folder?.fsPath === 'string' && isPathInside(uri.fsPath, folder.fsPath)
            )
          }
        : { scheme: uri.scheme, path: uri.path }
      const found = toLeanClient(findClientFn.call(provider, extUriLike))
      if (found) {
        return found
      }
    }
    catch {
      // Fall back to active/client list resolution.
    }
  }

  const candidates: LeanClientLike[] = []
  const seen = new Set<unknown>()
  const getActiveClientFn = asFunction(providerRecord.getActiveClient)
  if (getActiveClientFn) {
    try {
      const activeClient = getActiveClientFn.call(provider)
      const parsedClient = toLeanClient(activeClient)
      if (parsedClient && !seen.has(activeClient)) {
        seen.add(activeClient)
        candidates.push(parsedClient)
      }
    }
    catch {
      // Ignore and continue.
    }
  }

  const getClientsFn = asFunction(providerRecord.getClients)
  if (getClientsFn) {
    try {
      const listed = getClientsFn.call(provider)
      for (const client of Array.isArray(listed) ? listed : []) {
        const parsedClient = toLeanClient(client)
        if (parsedClient && !seen.has(client)) {
          seen.add(client)
          candidates.push(parsedClient)
        }
      }
    }
    catch {
      // Ignore and continue.
    }
  }

  return pickBestLeanClient(candidates, fileUri)
}

type GoalPosition = {
  line: number
  character: number
}

const buildGoalPositions = (
  fileUri: string,
  diagnostics: readonly vscode.Diagnostic[]
): GoalPosition[] => {
  const positions: GoalPosition[] = []
  const seen = new Set<string>()
  const push = (line: number, character: number) => {
    const safeLine = Math.max(0, Math.floor(line))
    const safeCharacter = Math.max(0, Math.floor(character))
    const key = `${safeLine}:${safeCharacter}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    positions.push({ line: safeLine, character: safeCharacter })
  }

  for (const diagnostic of diagnostics.slice(0, 12)) {
    push(diagnostic.range.start.line, diagnostic.range.start.character)
  }

  const activeEditor = vscode.window.activeTextEditor
  if (activeEditor && activeEditor.document.uri.toString() === fileUri) {
    push(activeEditor.selection.active.line, activeEditor.selection.active.character)
  }

  if (positions.length === 0) {
    push(0, 0)
  }

  return positions
}

const toTdpp = (fileUri: string, position: GoalPosition): {
  textDocument: { uri: string }
  position: GoalPosition
} => ({
  textDocument: { uri: fileUri },
  position
})

const toRangeAroundPosition = (position: GoalPosition): Range => ({
  startLine: position.line + 1,
  startCol: position.character,
  endLine: position.line + 1,
  endCol: position.character + 1
})

const normalizePlainGoalResponse = (
  payload: unknown,
  fallbackRange: Range,
  source: string
): LeanGoalHint[] => {
  const record = asRecord(payload)
  if (!record) {
    return []
  }

  const goals: string[] = []
  goals.push(...asStringList(record.goals))

  if (goals.length === 0 && typeof record.rendered === 'string') {
    goals.push(...extractGoalLines(record.rendered))
  }

  return goals
    .map((goal) => goal.trim())
    .filter((goal) => goal.length > 0)
    .map((goal) => ({
      goal,
      range: fallbackRange,
      source
    }))
}

const normalizePlainTermGoalResponse = (
  payload: unknown,
  fallbackRange: Range,
  source: string
): LeanGoalHint[] => {
  const record = asRecord(payload)
  if (!record || typeof record.goal !== 'string') {
    return []
  }

  const goal = record.goal.trim()
  if (goal.length === 0) {
    return []
  }

  return [{
    goal,
    range: asRange(record.range) ?? fallbackRange,
    source
  }]
}

const loadGoalHintsFromLeanStableRequests = async (
  fileUri: string,
  diagnostics: readonly vscode.Diagnostic[]
): Promise<{ hints: LeanGoalHint[]; methodsUsed: string[] }> => {
  const leanClient = await resolveLeanClient(fileUri)
  if (!leanClient) {
    return { hints: [], methodsUsed: [] }
  }

  const hints: LeanGoalHint[] = []
  const methodsUsed: string[] = []
  const positions = buildGoalPositions(fileUri, diagnostics)
  const maxPositions = 8

  for (const position of positions.slice(0, maxPositions)) {
    const tdpp = toTdpp(fileUri, position)
    const fallbackRange = toRangeAroundPosition(position)

    try {
      const plainGoalPayload = await leanClient.sendRequest('$/lean/plainGoal', tdpp)
      const plainGoalHints = normalizePlainGoalResponse(
        plainGoalPayload,
        fallbackRange,
        'stable:$/lean/plainGoal'
      )
      if (plainGoalHints.length > 0) {
        hints.push(...plainGoalHints)
        if (!methodsUsed.includes(LEAN_STABLE_GOAL_METHODS[0])) {
          methodsUsed.push(LEAN_STABLE_GOAL_METHODS[0])
        }
      }
    }
    catch {
      // Ignore method failures and keep collecting from other sources.
    }

    try {
      const termGoalPayload = await leanClient.sendRequest('$/lean/plainTermGoal', tdpp)
      const termGoalHints = normalizePlainTermGoalResponse(
        termGoalPayload,
        fallbackRange,
        'stable:$/lean/plainTermGoal'
      )
      if (termGoalHints.length > 0) {
        hints.push(...termGoalHints)
        if (!methodsUsed.includes(LEAN_STABLE_GOAL_METHODS[1])) {
          methodsUsed.push(LEAN_STABLE_GOAL_METHODS[1])
        }
      }
    }
    catch {
      // Ignore method failures and keep collecting from other sources.
    }

    if (hints.length >= 32) {
      break
    }
  }

  return { hints, methodsUsed }
}

const dedupeGoalHints = (hints: readonly LeanGoalHint[]): LeanGoalHint[] => {
  const result: LeanGoalHint[] = []
  const seen = new Set<string>()
  for (const hint of hints) {
    const goal = hint.goal.trim()
    if (goal.length === 0) {
      continue
    }

    const rangeKey = hint.range
      ? `${hint.range.startLine}:${hint.range.startCol}:${hint.range.endLine}:${hint.range.endCol}`
      : ''
    const key = [goal, hint.nodeId ?? '', rangeKey, hint.source ?? ''].join('|')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(hint)
  }
  return result
}

const resolveLeanExtensionApiMethods = async (): Promise<Array<{
  name: string
  fn: (...args: unknown[]) => unknown
}>> => {
  if (cachedLeanExtensionApiMethods.size > 0) {
    return Array.from(cachedLeanExtensionApiMethods.entries()).map(([name, fn]) => ({ name, fn }))
  }

  const extensionsApi = vscode.extensions as typeof vscode.extensions | undefined
  if (!extensionsApi) {
    return []
  }

  for (const extensionId of LEAN_EXTENSION_IDS) {
    const extension = extensionsApi.getExtension(extensionId)
    if (!extension) {
      continue
    }

    const exports = extension.isActive
      ? extension.exports
      : await extension.activate()

    for (const path of LEAN_API_METHOD_PATHS) {
      const resolved = resolveNestedField(exports, path)
      const fn = asFunction(resolved)
      if (!fn) {
        continue
      }

      const methodName = `${extensionId}:${path}`
      if (!cachedLeanExtensionApiMethods.has(methodName)) {
        cachedLeanExtensionApiMethods.set(methodName, fn)
      }
    }
  }

  return Array.from(cachedLeanExtensionApiMethods.entries()).map(([name, fn]) => ({ name, fn }))
}

const buildLeanApiArgs = (
  fileUri: string,
  diagnostics: readonly vscode.Diagnostic[]
): unknown[][] => {
  const uri = vscode.Uri.parse(fileUri)
  const first = diagnostics[0]
  const line = first?.range.start.line ?? 0
  const character = first?.range.start.character ?? 0

  return [
    [{ fileUri }],
    [{ uri: fileUri }],
    [fileUri],
    [uri],
    [{ fileUri, position: { line: line + 1, column: character } }],
    [{ uri: fileUri, position: { line: line + 1, column: character } }],
    [uri, new vscode.Position(line, character)],
    [uri, { line, character }],
    []
  ]
}

const loadGoalHintsFromLeanExtensionApi = async (
  fileUri: string,
  diagnostics: readonly vscode.Diagnostic[]
): Promise<{ hints: LeanGoalHint[]; methodsUsed: string[] }> => {
  const methods = await resolveLeanExtensionApiMethods()
  if (methods.length === 0) {
    return { hints: [], methodsUsed: [] }
  }

  const hints: LeanGoalHint[] = []
  const methodsUsed: string[] = []
  const argsCandidates = buildLeanApiArgs(fileUri, diagnostics)
  const maxMethods = 3

  for (const method of methods.slice(0, maxMethods)) {
    let matched = false
    for (const args of argsCandidates) {
      try {
        const payload = await method.fn(...args)
        const normalized = normalizeGoalHints(payload, `api:${method.name}`)
        if (normalized.length === 0) {
          continue
        }

        hints.push(...normalized)
        matched = true
        break
      }
      catch {
        // Ignore method-specific signature mismatch and keep probing.
      }
    }

    if (matched) {
      methodsUsed.push(method.name)
    }
  }

  return { hints, methodsUsed }
}

const discoverLeanGoalCommands = async (): Promise<string[]> => {
  if (cachedGoalCommands) {
    return cachedGoalCommands
  }

  const commandsApi = vscode.commands as typeof vscode.commands & {
    getCommands?: (filterInternal?: boolean) => Thenable<string[]>
  }

  if (typeof commandsApi.getCommands !== 'function') {
    cachedGoalCommands = []
    return cachedGoalCommands
  }

  try {
    const all = await commandsApi.getCommands(true)
    const discovered = all.filter((command) => (
      command.startsWith('lean4.')
      && /(goal|infoview)/i.test(command)
      && /(get|fetch|request|state|goals)/i.test(command)
    ))

    const merged = [...LEAN_GOAL_COMMAND_CANDIDATES, ...discovered]
    const unique: string[] = []
    for (const command of merged) {
      if (!all.includes(command)) {
        continue
      }
      if (!unique.includes(command)) {
        unique.push(command)
      }
    }

    cachedGoalCommands = unique
    return cachedGoalCommands
  }
  catch {
    cachedGoalCommands = []
    return cachedGoalCommands
  }
}

const buildGoalCommandArgs = (
  fileUri: string,
  diagnostics: readonly vscode.Diagnostic[]
): unknown[][] => {
  const uri = vscode.Uri.parse(fileUri)
  const first = diagnostics[0]
  const line = first?.range.start.line ?? 0
  const character = first?.range.start.character ?? 0

  return [
    [{ fileUri }],
    [{ uri: fileUri }],
    [fileUri],
    [uri],
    [{ fileUri, position: { line: line + 1, column: character } }],
    [{ uri: fileUri, position: { line: line + 1, column: character } }],
    [uri, new vscode.Position(line, character)],
    [uri, { line, character }],
    []
  ]
}

const loadGoalHintsFromLeanCommands = async (
  fileUri: string,
  diagnostics: readonly vscode.Diagnostic[]
): Promise<{ hints: LeanGoalHint[]; commandsUsed: string[] }> => {
  const commands = await discoverLeanGoalCommands()
  if (commands.length === 0) {
    return { hints: [], commandsUsed: [] }
  }

  const execute = vscode.commands.executeCommand as unknown as (command: string, ...args: unknown[]) => Promise<unknown>
  const hints: LeanGoalHint[] = []
  const commandsUsed: string[] = []
  const argsCandidates = buildGoalCommandArgs(fileUri, diagnostics)
  const maxCommands = 4

  for (const command of commands.slice(0, maxCommands)) {
    let commandMatched = false
    for (const args of argsCandidates) {
      try {
        const payload = await execute(command, ...args)
        const normalized = normalizeGoalHints(payload, `command:${command}`)
        if (normalized.length === 0) {
          continue
        }

        hints.push(...normalized)
        commandMatched = true
        break
      }
      catch {
        // Ignore signature mismatch and continue probing next call shape.
      }
    }

    if (commandMatched) {
      commandsUsed.push(command)
    }
  }

  return { hints, commandsUsed }
}

const clampPositionToDocument = (
  document: vscode.TextDocument,
  position: { line: number; character: number }
): vscode.Position => {
  if (document.lineCount <= 0) {
    return new vscode.Position(0, 0)
  }

  const safeLine = Math.max(0, Math.min(position.line, document.lineCount - 1))
  const lineText = document.lineAt(safeLine).text
  const safeCharacter = Math.max(0, Math.min(position.character, lineText.length))
  return new vscode.Position(safeLine, safeCharacter)
}

const resolveApplyInsertionPosition = (
  document: vscode.TextDocument,
  fileUri: string,
  nodeId: string,
  fallback: vscode.Position
): vscode.Position => {
  const state = app?.getState<ProofFlowState>().data
  const range = state?.files[fileUri]?.dag?.nodes[nodeId]?.leanRange
  if (!range) {
    return fallback
  }

  return clampPositionToDocument(document, {
    line: Math.max(0, range.endLine - 1),
    character: Math.max(0, range.endCol)
  })
}

const applySuggestionToEditor = async (input: {
  fileUri: string
  nodeId: string
  tactic: string
}): Promise<{
  applied: boolean
  errorMessage?: string | null
  durationMs?: number | null
}> => {
  const tactic = input.tactic.trim()
  if (tactic.length === 0) {
    return {
      applied: false,
      errorMessage: 'empty tactic',
      durationMs: 0
    }
  }

  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(input.fileUri))
  const editor = await vscode.window.showTextDocument(document)
  const insertAt = resolveApplyInsertionPosition(
    document,
    input.fileUri,
    input.nodeId,
    editor.selection.active
  )

  const startedAt = Date.now()
  const applied = await editor.edit((builder) => {
    builder.insert(insertAt, `${tactic}\n`)
  })

  return {
    applied,
    errorMessage: applied ? null : 'editor rejected edit',
    durationMs: Date.now() - startedAt
  }
}

const proofFlowEffects: Effects = createProofFlowEffects({
  dagExtract: {
    loadContext: async ({ fileUri }) => {
      const uri = vscode.Uri.parse(fileUri)
      const document = await vscode.workspace.openTextDocument(uri)
      const diagnostics = vscode.languages.getDiagnostics(uri)
      return {
        fileUri,
        sourceText: document.getText(),
        diagnostics: diagnostics.map(toLeanDiagnostic),
        goals: extractGoalHintsFromDiagnostics(diagnostics)
      }
    },
    loadGoals: async ({ fileUri }, context) => {
      const uri = vscode.Uri.parse(fileUri)
      const diagnostics = vscode.languages.getDiagnostics(uri)
      const stableResult = await loadGoalHintsFromLeanStableRequests(fileUri, diagnostics)
      const diagnosticHints = context.goals ?? extractGoalHintsFromDiagnostics(diagnostics)
      const hoverHints = await extractGoalHintsFromHoverProvider(uri, diagnostics)
      const apiResult = await loadGoalHintsFromLeanExtensionApi(fileUri, diagnostics)
      const commandResult = await loadGoalHintsFromLeanCommands(fileUri, diagnostics)
      const stableRangedHints = stableResult.hints.filter((hint) => Boolean(hint.range))
      const stableUnrangedHints = stableResult.hints.filter((hint) => !hint.range)
      const merged = dedupeGoalHints([
        ...stableRangedHints,
        ...diagnosticHints,
        ...hoverHints,
        ...apiResult.hints,
        ...commandResult.hints,
        ...stableUnrangedHints
      ])

      goalSourceStatsByFileUri.set(fileUri, {
        stableHints: stableResult.hints.length,
        diagnosticHints: diagnosticHints.length,
        hoverHints: hoverHints.length,
        apiHints: apiResult.hints.length,
        commandHints: commandResult.hints.length,
        stableMethodsUsed: stableResult.methodsUsed,
        apiMethodsUsed: apiResult.methodsUsed,
        commandsUsed: commandResult.commandsUsed
      })

      return merged
    }
  },
  editorReveal: {
    reveal: async ({ fileUri, range }) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(fileUri))
      const editor = await vscode.window.showTextDocument(document)
      editor.revealRange(toVscodeRange(range), vscode.TextEditorRevealType.InCenter)
    }
  },
  editorGetCursor: {
    getCursor: async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        throw new Error('No active editor')
      }

      const position = editor.selection.active
      return {
        fileUri: editor.document.uri.toString(),
        position: {
          line: position.line + 1,
          column: position.character
        }
      }
    }
  },
  attemptApply: {
    apply: async (input) => applySuggestionToEditor({
      fileUri: input.fileUri,
      nodeId: input.nodeId,
      tactic: input.tactic
    })
  }
})

const readDomainMel = async (): Promise<string> => {
  const workspace = vscode.workspace.workspaceFolders?.[0]
  if (!workspace) {
    throw new Error('ProofFlow requires an opened workspace folder.')
  }

  const domainUri = vscode.Uri.joinPath(
    workspace.uri,
    'packages',
    'schema',
    'domain.mel'
  )
  const bytes = await vscode.workspace.fs.readFile(domainUri)
  return new TextDecoder().decode(bytes)
}

const ensureApp = async (): Promise<App> => {
  if (app) {
    return app
  }

  const workspace = vscode.workspace.workspaceFolders?.[0]
  if (!workspace) {
    throw new Error('ProofFlow requires an opened workspace folder.')
  }

  const schema = await readDomainMel()
  const world = await createProofFlowWorld({
    world: {
      rootPath: workspace.uri.fsPath
    }
  })

  app = createProofFlowApp({
    schema,
    effects: proofFlowEffects,
    world
  })
  await app.ready()
  return app
}

const actSafely = async (type: string, input?: unknown): Promise<void> => {
  if (!app) {
    return
  }

  try {
    await app.act(type, input).done()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void vscode.window.showWarningMessage(`[ProofFlow] ${type} failed: ${message}`)
  }
}

const toAttemptResult = (status: StatusKind): AttemptResult => {
  switch (status) {
    case 'resolved': return 'success'
    case 'error': return 'error'
    case 'sorry': return 'placeholder'
    default: return 'placeholder'
  }
}

const maybeRecordAttempt = async (targetFileUri: string): Promise<void> => {
  if (!app) {
    return
  }

  const state = app.getState<ProofFlowState>().data
  const file = state.files[targetFileUri]
  const dag = file?.dag
  if (!dag) {
    return
  }

  const nodeId = state.ui.cursorNodeId ?? state.ui.selectedNodeId
  if (!nodeId) {
    return
  }

  const node = dag.nodes[nodeId]
  if (!node || node.status.kind === 'in_progress') {
    return
  }

  const fingerprint = [
    node.status.kind,
    node.status.errorCategory ?? '',
    node.status.errorMessage ?? ''
  ].join('|')
  const key = `${targetFileUri}:${nodeId}`
  if (attemptFingerprints.get(key) === fingerprint) {
    return
  }

  attemptFingerprints.set(key, fingerprint)
  await actSafely('attempt_record', {
    fileUri: targetFileUri,
    nodeId,
    tactic: `auto:${node.kind}`,
    tacticKey: node.kind,
    result: toAttemptResult(node.status.kind),
    contextErrorCategory: node.status.errorCategory,
    errorMessage: node.status.errorMessage,
    durationMs: null
  })
}

const reportGoalCoverage = async (): Promise<void> => {
  if (!app) {
    return
  }

  const state = app.getState<ProofFlowState>().data
  const activeFileUri = state.ui.activeFileUri
  if (!activeFileUri) {
    void vscode.window.showInformationMessage('[ProofFlow] No active Lean file for goal coverage.')
    return
  }

  const dag = state.files[activeFileUri]?.dag
  if (!dag) {
    void vscode.window.showInformationMessage('[ProofFlow] No DAG available for active file.')
    return
  }

  const nodes = Object.values(dag.nodes)
  const totalNodes = nodes.length
  const withGoal = nodes.filter((node) => typeof node.goal === 'string' && node.goal.trim().length > 0).length
  const ratio = totalNodes > 0 ? withGoal / totalNodes : 0
  const percent = (ratio * 100).toFixed(1)
  const stats = goalSourceStatsByFileUri.get(activeFileUri)
  const sourceSummary = stats
    ? ` | hints s/d/h/a/c=${stats.stableHints}/${stats.diagnosticHints}/${stats.hoverHints}/${stats.apiHints}/${stats.commandHints}`
      + (stats.stableMethodsUsed.length > 0 ? ` | stable=${stats.stableMethodsUsed.join(',')}` : '')
      + (stats.apiMethodsUsed.length > 0 ? ` | api=${stats.apiMethodsUsed.join(',')}` : '')
      + (stats.commandsUsed.length > 0 ? ` | cmds=${stats.commandsUsed.join(',')}` : '')
    : ''
  const message = `[ProofFlow] Goal coverage ${withGoal}/${totalNodes} (${percent}%)${sourceSummary}`
  void vscode.window.showInformationMessage(message)
}

export async function activate(context: vscode.ExtensionContext) {
  let readyApp: App

  const resetPatterns = async (): Promise<void> => {
    attemptFingerprints.clear()
    await actSafely('patterns_reset')
  }

  const suggestTacticsForCurrentNode = async (): Promise<void> => {
    if (!app) {
      return
    }

    const state = app.getState<ProofFlowState>().data
    const fileUri = state.ui.activeFileUri
    const nodeId = state.ui.selectedNodeId ?? state.ui.cursorNodeId
    if (!fileUri || !nodeId) {
      void vscode.window.showInformationMessage('[ProofFlow] Select a node before requesting suggestions.')
      return
    }

    await actSafely('attempt_suggest', { fileUri, nodeId })
  }

  const applySuggestionForCurrentNode = async (tacticKey: string): Promise<void> => {
    if (!app) {
      return
    }

    const state = app.getState<ProofFlowState>().data
    const fileUri = state.ui.activeFileUri
    const nodeId = state.ui.selectedNodeId ?? state.ui.cursorNodeId
    if (!fileUri || !nodeId) {
      void vscode.window.showInformationMessage('[ProofFlow] Select a node before applying a suggestion.')
      return
    }

    const node = state.files[fileUri]?.dag?.nodes[nodeId]
    await actSafely('attempt_apply', {
      fileUri,
      nodeId,
      tactic: tacticKey,
      tacticKey,
      contextErrorCategory: node?.status.errorCategory ?? null,
      errorMessage: node?.status.errorMessage ?? null
    })

    await actSafely('dag_sync', { fileUri })
    await actSafely('attempt_suggest', { fileUri, nodeId })
  }

  panelController = new ProjectionPanelController(context, {
    onNodeSelect: async (nodeId) => {
      await actSafely('node_select', { nodeId })
    },
    onTogglePanel: async () => {
      await actSafely('panel_toggle')
    },
    onSetLayout: async (layout) => {
      await actSafely('layout_set', { layout })
    },
    onSetZoom: async (zoom) => {
      await actSafely('zoom_set', { zoom })
    },
    onToggleCollapse: async () => {
      await actSafely('collapse_toggle')
    },
    onResetPatterns: async () => {
      await resetPatterns()
    },
    onSuggestTactics: async () => {
      await suggestTacticsForCurrentNode()
    },
    onApplySuggestion: async (tacticKey) => {
      await applySuggestionForCurrentNode(tacticKey)
    }
  })

  context.subscriptions.push(panelController)

  try {
    readyApp = await ensureApp()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void vscode.window.showErrorMessage(`[ProofFlow] Activation failed: ${message}`)
    return
  }

  const unsubscribeProjection = readyApp.subscribe(
    (state) => selectProjectionState(state),
    (projection) => {
      panelController?.setState(projection)
    }
  )
  context.subscriptions.push(new vscode.Disposable(unsubscribeProjection))

  const togglePanel = vscode.commands.registerCommand('proof-flow.hello', async () => {
    const visible = app?.getState<ProofFlowState>().data.ui.panelVisible ?? false

    if (visible && !panelController?.isOpen()) {
      panelController?.reveal()
      return
    }

    await actSafely('panel_toggle')

    const nextVisible = app?.getState<ProofFlowState>().data.ui.panelVisible ?? false
    if (nextVisible) {
      panelController?.reveal()
    }
  })

  const resetPatternsCommand = vscode.commands.registerCommand('proof-flow.patternsReset', async () => {
    await resetPatterns()
  })

  const suggestTacticsCommand = vscode.commands.registerCommand('proof-flow.suggestTactics', async () => {
    await suggestTacticsForCurrentNode()
  })

  const goalCoverageReportCommand = vscode.commands.registerCommand('proof-flow.goalCoverageReport', async () => {
    await reportGoalCoverage()
  })

  const onEditorChange = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (!editor || !isLeanDocument(editor.document)) {
      return
    }

    const fileUri = editor.document.uri.toString()
    await actSafely('file_activate', { fileUri })
    await actSafely('dag_sync', { fileUri })
  })

  const onDocumentSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (!isLeanDocument(document)) {
      return
    }

    const fileUri = document.uri.toString()
    await actSafely('dag_sync', { fileUri })
    await maybeRecordAttempt(fileUri)
  })

  const onDiagnosticsChange = vscode.languages.onDidChangeDiagnostics(async (event) => {
    const leanUris = event.uris.filter((uri) => isLeanUri(uri))
    for (const uri of leanUris) {
      const fileUri = uri.toString()
      await actSafely('dag_sync', { fileUri })
      await maybeRecordAttempt(fileUri)
    }
  })

  const onSelectionChange = vscode.window.onDidChangeTextEditorSelection(async (event) => {
    if (!app || !isLeanDocument(event.textEditor.document)) {
      return
    }

    const fileUri = event.textEditor.document.uri.toString()
    const state = app.getState<ProofFlowState>().data
    const dag = state.files[fileUri]?.dag
    const nodeId = dag
      ? resolveNodeIdAtCursor(dag, {
          fileUri,
          position: {
            line: event.selections[0]?.active.line + 1,
            column: event.selections[0]?.active.character ?? 0
          }
        })
      : null

    await actSafely('cursor_sync', {
      resolvedNodeId: nodeId
    })
  })

  context.subscriptions.push(
    togglePanel,
    resetPatternsCommand,
    suggestTacticsCommand,
    goalCoverageReportCommand,
    onEditorChange,
    onDocumentSave,
    onDiagnosticsChange,
    onSelectionChange
  )

  const activeEditor = vscode.window.activeTextEditor
  if (activeEditor && isLeanDocument(activeEditor.document)) {
    const fileUri = activeEditor.document.uri.toString()
    await actSafely('file_activate', {
      fileUri
    })
    await actSafely('dag_sync', {
      fileUri
    })
  }
}

export async function deactivate() {
  panelController?.dispose()
  panelController = null

  if (!app) {
    attemptFingerprints.clear()
    goalSourceStatsByFileUri.clear()
    cachedGoalCommands = undefined
    cachedLeanExtensionApiMethods.clear()
    cachedLeanClientProvider = undefined
    lastLeanClientProviderMissAt = 0
    return
  }

  await app.dispose()
  app = null
  attemptFingerprints.clear()
  goalSourceStatsByFileUri.clear()
  cachedGoalCommands = undefined
  cachedLeanExtensionApiMethods.clear()
  cachedLeanClientProvider = undefined
  lastLeanClientProviderMissAt = 0
}
