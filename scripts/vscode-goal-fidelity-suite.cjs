const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const sampleFiles = [
  'GoalFidelitySamples/Basic.lean',
  'GoalFidelitySamples/MathlibSample.lean',
  'GoalFidelitySamples/StableOnly.lean',
  'GoalFidelitySamples/InsertionSortInteractive.lean',
  'GoalFidelitySamples/ProofAttempt.lean'
]

const resolveProofAttemptProof = () => (
  [
    'theorem proofAttempt (n : Nat) : n + 0 = n := by',
    '  induction n with',
    '  | zero => simp',
    '  | succ n ih => simpa [Nat.succ_add, Nat.add_succ] using congrArg (fun x => x + 1) ih',
    ''
  ].join('\n')
)

const findProofFlowExtension = () => {
  return vscode.extensions.all.find((extension) => {
    const packageName = extension.packageJSON?.name
    return packageName === '@proof-flow/app' || extension.id.endsWith('.@proof-flow/app')
  }) ?? null
}

const normalizeLineage = (value) => {
  const payload = value && typeof value === 'object' ? value : {}
  const branch = payload.branch && typeof payload.branch === 'object' ? payload.branch : {}

  return {
    measuredAt: typeof payload.measuredAt === 'string' ? payload.measuredAt : new Date().toISOString(),
    headWorldId: branch.headWorldId ?? null,
    lineageLength: Number(branch.lineageLength ?? 0),
    summary: {
      edges: Number(payload.summary?.edges ?? 0),
      added: Number(payload.summary?.added ?? 0),
      removed: Number(payload.summary?.removed ?? 0),
      statusChanged: Number(payload.summary?.statusChanged ?? 0)
    },
    worldIds: Array.isArray(payload.worldIds)
      ? payload.worldIds.filter((id) => typeof id === 'string' && id.length > 0)
      : [],
    diffs: Array.isArray(payload.diffs) ? payload.diffs : []
  }
}

const readLineageSnapshot = async (timeoutMs = 15000) => {
  const startedAt = Date.now()
  let latest = null

  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      latest = await vscode.commands.executeCommand('proof-flow.lineageDiffReport', { limit: 128 })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('not found') || message.includes('command "proof-flow.lineageDiffReport" not found')) {
        await wait(200)
        continue
      }
      throw error
    }

    const normalized = normalizeLineage(latest)
    if (normalized.lineageLength > 0 || normalized.headWorldId) {
      return normalized
    }

    await wait(200)
  }

  return normalizeLineage(latest)
}

const patchProofAttemptFile = async (document, editor) => {
  const fullRange = new vscode.Range(
    new vscode.Position(0, 0),
    document.lineAt(Math.max(0, document.lineCount - 1)).range.end
  )
  const replaced = await editor.edit((builder) => {
    builder.replace(fullRange, resolveProofAttemptProof())
  })
  assert.equal(replaced, true, 'proof attempt proof replacement failed')
}

const toNumericDelta = (current, previous, key) => (
  Number(current?.[key] ?? 0) - Number(previous?.[key] ?? 0)
)

async function run() {
  const workspace = vscode.workspace.workspaceFolders?.[0]
  assert.ok(workspace, 'workspace folder is required')

  const proofFlow = findProofFlowExtension()
  assert.ok(proofFlow, 'proof-flow extension not found')
  await proofFlow.activate()
  await wait(300)

  const samples = []
  for (const relativePath of sampleFiles) {
    const uri = vscode.Uri.joinPath(workspace.uri, relativePath)
    const document = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(document)
    await wait(400)

    const before = await readLineageSnapshot(12000)

    if (relativePath.endsWith('ProofAttempt.lean')) {
      await patchProofAttemptFile(document, editor)
    }

    const saved = await document.save()
    assert.equal(saved, true, `sample save failed: ${relativePath}`)
    await wait(1200)
    await vscode.commands.executeCommand('proof-flow.hello')
    const after = await readLineageSnapshot(12000)

    samples.push({
      sample: relativePath,
      before,
      after,
      delta: {
        edges: toNumericDelta(after.summary, before.summary, 'edges'),
        added: toNumericDelta(after.summary, before.summary, 'added'),
        removed: toNumericDelta(after.summary, before.summary, 'removed'),
        statusChanged: toNumericDelta(after.summary, before.summary, 'statusChanged')
      }
    })

    await wait(500)
  }

  const totals = samples.reduce((acc, entry) => ({
    edges: acc.edges + entry.delta.edges,
    added: acc.added + entry.delta.added,
    removed: acc.removed + entry.delta.removed,
    statusChanged: acc.statusChanged + entry.delta.statusChanged
  }), {
    edges: 0,
    added: 0,
    removed: 0,
    statusChanged: 0
  })

  const hasExtractableProofData = samples.some((entry) => (
    entry.delta.edges + entry.delta.added + entry.delta.removed + entry.delta.statusChanged
  ) > 0)
  assert.ok(
    hasExtractableProofData,
    `Expected at least one sample to surface proof-related world delta. Report: ${
      JSON.stringify({
        samples: samples.map((entry) => ({
          sample: entry.sample,
          delta: entry.delta
        }))
      }, null, 2)
    }`
  )

  const report = {
    measuredAt: new Date().toISOString(),
    workspace: workspace.uri.fsPath,
    samples,
    totals
  }

  const reportPath = process.env.GOAL_FIDELITY_REPORT_PATH
    ? path.resolve(process.env.GOAL_FIDELITY_REPORT_PATH)
    : path.resolve(workspace.uri.fsPath, '..', '..', 'reports', 'goal-fidelity-report.json')

  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

  // Keep console output compact so the runner log is easy to parse.
  // eslint-disable-next-line no-console
  console.log(`Goal fidelity report written: ${reportPath}`)
}

module.exports = { run }
