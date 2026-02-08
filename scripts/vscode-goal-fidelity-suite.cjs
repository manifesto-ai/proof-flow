const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const sampleFiles = [
  'GoalFidelitySamples/Basic.lean',
  'GoalFidelitySamples/MathlibSample.lean'
]

const findProofFlowExtension = () => {
  return vscode.extensions.all.find((extension) => {
    const packageName = extension.packageJSON?.name
    return packageName === '@proof-flow/app' || extension.id.endsWith('.@proof-flow/app')
  }) ?? null
}

const normalizeSnapshot = (snapshot, fileUri) => {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      fileUri,
      totalNodes: 0,
      withGoal: 0,
      ratio: 0,
      percent: '0.0',
      sources: null,
      readiness: {
        status: 'warming',
        waitedMs: 0,
        leanClientReady: false,
        dagSynced: false,
        lastSyncedAt: null
      }
    }
  }

  return {
    fileUri: snapshot.fileUri || fileUri,
    totalNodes: Number(snapshot.totalNodes || 0),
    withGoal: Number(snapshot.withGoal || 0),
    ratio: Number(snapshot.ratio || 0),
    percent: String(snapshot.percent || '0.0'),
    sources: snapshot.sources || null,
    readiness: snapshot.readiness || {
      status: 'warming',
      waitedMs: 0,
      leanClientReady: false,
      dagSynced: false,
      lastSyncedAt: null
    }
  }
}

async function waitForCoverageSnapshot(timeoutMs) {
  const startedAt = Date.now()
  let latest = null

  while ((Date.now() - startedAt) < timeoutMs) {
    latest = await vscode.commands.executeCommand('proof-flow.goalCoverageSnapshot')
    const normalized = normalizeSnapshot(latest, '')

    if (normalized.totalNodes > 0 && normalized.readiness.status !== 'warming') {
      return normalized
    }

    await wait(500)
  }

  return normalizeSnapshot(latest, '')
}

async function run() {
  const workspace = vscode.workspace.workspaceFolders?.[0]
  assert.ok(workspace, 'workspace folder is required')

  const proofFlow = findProofFlowExtension()
  assert.ok(proofFlow, 'proof-flow extension not found')
  await proofFlow.activate()
  await wait(300)

  const results = []
  for (const relativePath of sampleFiles) {
    const uri = vscode.Uri.joinPath(workspace.uri, relativePath)
    const document = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(document)
    await wait(1500)
    await document.save()
    await wait(3000)

    const snapshot = await waitForCoverageSnapshot(30000)
    results.push({
      sample: relativePath,
      ...normalizeSnapshot(snapshot, uri.toString())
    })
  }

  const totalNodes = results.reduce((sum, entry) => sum + entry.totalNodes, 0)
  const withGoal = results.reduce((sum, entry) => sum + entry.withGoal, 0)
  const ratio = totalNodes > 0 ? withGoal / totalNodes : 0
  const summary = {
    measuredAt: new Date().toISOString(),
    workspace: workspace.uri.fsPath,
    totalNodes,
    withGoal,
    ratio,
    percent: (ratio * 100).toFixed(1),
    samples: results
  }

  const hasGoalCoverage = results.some((entry) => entry.withGoal > 0)
  assert.ok(
    hasGoalCoverage,
    `Expected at least one sample with goal coverage > 0. Got: ${JSON.stringify(results.map((entry) => ({
      sample: entry.sample,
      withGoal: entry.withGoal,
      totalNodes: entry.totalNodes,
      readiness: entry.readiness,
      probeFailures: entry.sources?.probeFailures?.slice(0, 3) ?? []
    })), null, 2)}`
  )

  const reportPath = process.env.GOAL_FIDELITY_REPORT_PATH
    ? path.resolve(process.env.GOAL_FIDELITY_REPORT_PATH)
    : path.resolve(workspace.uri.fsPath, '..', '..', 'reports', 'goal-fidelity-report.json')

  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.writeFile(reportPath, JSON.stringify(summary, null, 2), 'utf8')

  // Keep console output compact so the runner log is easy to parse.
  // eslint-disable-next-line no-console
  console.log(`Goal fidelity report written: ${reportPath}`)
}

module.exports = { run }
