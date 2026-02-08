const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vscode = require('vscode')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function run() {
  const leanPath = path.join(os.tmpdir(), 'proof-flow-smoke.lean')
  await fs.writeFile(
    leanPath,
    'theorem smoke : True := by\n  trivial\n',
    'utf8'
  )

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(leanPath))
  await vscode.window.showTextDocument(document)
  await wait(1000)

  const saved = await document.save()
  assert.equal(saved, true)

  // Command should reveal first, then toggle on next call.
  await vscode.commands.executeCommand('proof-flow.hello')
  await wait(300)
  await vscode.commands.executeCommand('proof-flow.hello')
}

module.exports = { run }
