import path from 'node:path'
import process from 'node:process'
import { runTests } from '@vscode/test-electron'

const workspacePath = process.cwd()
const extensionDevelopmentPath = path.resolve(workspacePath, 'packages/app')
const extensionTestsPath = path.resolve(workspacePath, 'scripts/vscode-smoke-suite.cjs')

await runTests({
  extensionDevelopmentPath,
  extensionTestsPath,
  launchArgs: [workspacePath, '--disable-extensions']
})
