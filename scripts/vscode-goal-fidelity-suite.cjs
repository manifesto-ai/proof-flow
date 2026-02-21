const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const textEncoder = new TextEncoder()

const sampleFiles = [
  {
    path: 'GoalFidelitySamples/Basic.lean',
    expected: {
      minOpenGoals: 0,
      minEdges: 0,
      minStatusChanges: 0,
      minProofDelta: 0,
      maxGoalIdChurn: 0,
      requiresMathlib: false
    }
  },
  {
    path: 'GoalFidelitySamples/MathlibSample.lean',
    expected: {
      minOpenGoals: 1,
      minEdges: 0,
      minStatusChanges: 0,
      minProofDelta: 0,
      maxGoalIdChurn: 4,
      requiresMathlib: true
    }
  },
  {
    path: 'GoalFidelitySamples/Collatz.lean',
    expected: {
      minOpenGoals: 1,
      minEdges: 0,
      minStatusChanges: 0,
      minProofDelta: 0,
      maxGoalIdChurn: 6,
      requiresMathlib: true
    }
  },
  {
    path: 'GoalFidelitySamples/StableOnly.lean',
    expected: {
      minOpenGoals: 0,
      minEdges: 0,
      minStatusChanges: 0,
      minProofDelta: 0,
      maxGoalIdChurn: 2,
      requiresMathlib: false
    }
  },
  {
    path: 'GoalFidelitySamples/InsertionSortInteractive.lean',
    expected: {
      minOpenGoals: 1,
      minEdges: 0,
      minStatusChanges: 0,
      minProofDelta: 0,
      maxGoalIdChurn: 0,
      requiresMathlib: false
    }
  },
  {
    path: 'GoalFidelitySamples/ProofAttempt.lean',
    expected: {
      minOpenGoals: 0,
      minEdges: 0,
      minStatusChanges: 0,
      minProofDelta: 1,
      maxGoalIdChurn: 0,
      requiresMathlib: false
    }
  }
]

const toNumeric = (value) => Number(value ?? 0)

const findProofFlowExtension = () => {
  return vscode.extensions.all.find((extension) => {
    const packageName = String(extension.packageJSON?.name ?? '').toLowerCase()
    const id = String(extension.id ?? '').toLowerCase()

    return (
      packageName.includes('proof-flow') ||
      id.includes('proof-flow')
    )
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
      edges: toNumeric(payload.summary?.edges),
      added: toNumeric(payload.summary?.added),
      removed: toNumeric(payload.summary?.removed),
      statusChanged: toNumeric(payload.summary?.statusChanged)
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
      latest = await vscode.commands.executeCommand('proof-flow.lineageDiffReport', { limit: 256 })
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

    await wait(250)
  }

  return normalizeLineage(latest)
}

const countSorryGoals = (text) => {
  const matches = text.match(/\bsorry\b/g)
  return matches ? matches.length : 0
}

const toDelta = (after, before) => ({
  edges: toNumeric(after.summary.edges - before.summary.edges),
  added: toNumeric(after.summary.added - before.summary.added),
  removed: toNumeric(after.summary.removed - before.summary.removed),
  statusChanged: toNumeric(after.summary.statusChanged - before.summary.statusChanged)
})

const goalChangeStrength = (delta) => (
  delta.edges + delta.added + delta.removed + delta.statusChanged
)

const syncSample = async (document, editor, marker) => {
  const sourceBefore = document.getText()
  const sourceBytes = textEncoder.encode(sourceBefore)

  let saved = await document.save()
  if (!saved) {
    await vscode.workspace.fs.writeFile(document.uri, sourceBytes)
    await wait(300)
    saved = await document.save()
  }
  assert.equal(saved, true, `sample ${marker} save failed`)

  await wait(300)
  await editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.InCenter)
  await vscode.commands.executeCommand('proof-flow.hello')
  await wait(800)
}

const forceNoopSync = async (document, editor, marker) => {
  const sourceText = document.getText()
  let saved = await document.save()
  if (!saved) {
    await vscode.workspace.fs.writeFile(document.uri, textEncoder.encode(sourceText))
    await wait(300)
    saved = await document.save()
  }
  assert.equal(saved, true, `sample ${marker} repeat-save failed`)

  await wait(300)
  await vscode.commands.executeCommand('proof-flow.hello')
  await wait(800)
}

const patchProofAttemptFile = async (document, editor) => {
  const fullRange = new vscode.Range(
    new vscode.Position(0, 0),
    document.lineAt(Math.max(0, document.lineCount - 1)).range.end
  )
  const replaced = await editor.edit((builder) => {
    builder.replace(fullRange, [
      'theorem proofAttempt (n : Nat) : n + 0 = n := by',
      '  induction n with',
      '  | zero => simp',
      '  | succ n ih => simpa [Nat.succ_add, Nat.add_succ] using congrArg (fun x => x + 1) ih',
      ''
    ].join('\n'))
  })
  assert.equal(replaced, true, 'proof attempt proof replacement failed')
}

async function run() {
  const workspace = vscode.workspace.workspaceFolders?.[0]
  assert.ok(workspace, 'workspace folder is required')

  const proofFlow = findProofFlowExtension()
  assert.ok(proofFlow, 'proof-flow extension not found')
  await proofFlow.activate()
  await wait(300)

  const sampleReports = []

  for (const sample of sampleFiles) {
    const relativePath = sample.path
    const uri = vscode.Uri.joinPath(workspace.uri, relativePath)
    const document = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(document)
    await wait(400)

    const sourceText = document.getText()
    const sourceOpenGoals = countSorryGoals(sourceText)
    assert.ok(
      sourceOpenGoals >= sample.expected.minOpenGoals,
      `Expected ${sample.path} to include at least ${sample.expected.minOpenGoals} unresolved goals, found ${sourceOpenGoals}`
    )

    if (sample.expected.requiresMathlib) {
      assert.ok(
        /(^|\n)\s*import\s+Mathlib\b/.test(sourceText),
        `Expected ${sample.path} to import Mathlib`
      )
    }

    const beforeSync = await readLineageSnapshot(12000)

    if (relativePath.endsWith('ProofAttempt.lean')) {
      await patchProofAttemptFile(document, editor)
    }

    await syncSample(document, editor, relativePath)
    const afterSync = await readLineageSnapshot(12000)

    const delta = toDelta(afterSync, beforeSync)
    assert.ok(
      delta.edges >= sample.expected.minEdges,
      `Expected sample ${relativePath} to report at least ${sample.expected.minEdges} edge delta, got ${delta.edges}`
    )
    assert.ok(
      delta.statusChanged >= sample.expected.minStatusChanges,
      `Expected sample ${relativePath} to report at least ${sample.expected.minStatusChanges} status changes, got ${delta.statusChanged}`
    )
    assert.ok(
      goalChangeStrength(delta) >= sample.expected.minProofDelta,
      `Expected sample ${relativePath} to report proof-flow activity >= ${sample.expected.minProofDelta}, got ${JSON.stringify(delta)}`
    )

    const repeatBaseline = await readLineageSnapshot(12000)
    await forceNoopSync(document, editor, `${relativePath}(repeat)`)
    const repeatAfter = await readLineageSnapshot(12000)
    const repeatDelta = toDelta(repeatAfter, repeatBaseline)
    const goalIdChurn = repeatDelta.added + repeatDelta.removed

    const maxGoalIdChurn = Number(sample.expected?.maxGoalIdChurn ?? 0)
    assert.ok(
      goalIdChurn <= maxGoalIdChurn,
      `Expected stable goal-id churn for ${relativePath} <= ${maxGoalIdChurn}, got +${repeatDelta.added}/-${repeatDelta.removed}`
    )

    sampleReports.push({
      sample: relativePath,
      expected: sample.expected,
      before: {
        summary: beforeSync.summary,
        lineageLength: beforeSync.lineageLength,
        headWorldId: beforeSync.headWorldId
      },
      after: {
        summary: afterSync.summary,
        lineageLength: afterSync.lineageLength,
        headWorldId: afterSync.headWorldId
      },
      delta,
      repeat: {
        before: {
          summary: repeatBaseline.summary,
          lineageLength: repeatBaseline.lineageLength,
          headWorldId: repeatBaseline.headWorldId
        },
        after: {
          summary: repeatAfter.summary,
          lineageLength: repeatAfter.lineageLength,
          headWorldId: repeatAfter.headWorldId
        },
        delta: repeatDelta,
        goalIdChurn
      }
    })

    await wait(500)
  }

  const hasProofActivity = sampleReports.some((entry) => (
    goalChangeStrength(entry.delta) >= (entry.expected?.minProofDelta ?? 0)
  ))
  assert.ok(
    hasProofActivity,
    `Expected at least one sample to produce measurable proof delta. Report: ${
      JSON.stringify(sampleReports.map((entry) => ({
        sample: entry.sample,
        delta: entry.delta,
        repeat: entry.repeat.delta
      })), null, 2)
    }`
  )

  const totals = sampleReports.reduce((acc, entry) => ({
    edges: acc.edges + entry.delta.edges,
    added: acc.added + entry.delta.added,
    removed: acc.removed + entry.delta.removed,
    statusChanged: acc.statusChanged + entry.delta.statusChanged,
    goalIdChurn: acc.goalIdChurn + entry.repeat.goalIdChurn
  }), {
    edges: 0,
    added: 0,
    removed: 0,
    statusChanged: 0,
    goalIdChurn: 0
  })

  const report = {
    measuredAt: new Date().toISOString(),
    workspace: workspace.uri.fsPath,
    samples: sampleReports,
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
