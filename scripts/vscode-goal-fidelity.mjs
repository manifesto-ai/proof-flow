import path from 'node:path'
import process from 'node:process'
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { runTests } from '@vscode/test-electron'

const workspacePath = process.cwd()
const extensionDevelopmentPath = path.resolve(workspacePath, 'packages/app')
const extensionTestsPath = path.resolve(workspacePath, 'scripts/vscode-goal-fidelity-suite.cjs')
const reportPath = path.resolve(workspacePath, 'reports/goal-fidelity-report.json')
const defaultExtensionsDir = path.resolve(process.env.HOME ?? '', '.vscode/extensions')
const isolatedExtensionsDir = path.resolve(workspacePath, '.vscode-test/extensions-goal-fidelity')

const prepareLeanOnlyExtensionsDir = async () => {
  const entries = await readdir(defaultExtensionsDir, { withFileTypes: true })
  const leanExtensionDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('leanprover.lean4-'))
    .map((entry) => entry.name)
    .sort()

  if (leanExtensionDirs.length === 0) {
    throw new Error(
      `Lean extension not found in ${defaultExtensionsDir}. Install with: code --install-extension leanprover.lean4`
    )
  }

  const leanExtensionDir = leanExtensionDirs[leanExtensionDirs.length - 1]
  const source = path.resolve(defaultExtensionsDir, leanExtensionDir)
  const target = path.resolve(isolatedExtensionsDir, leanExtensionDir)

  await rm(isolatedExtensionsDir, { recursive: true, force: true })
  await mkdir(isolatedExtensionsDir, { recursive: true })
  await cp(source, target, { recursive: true })
}

await prepareLeanOnlyExtensionsDir()

await runTests({
  extensionDevelopmentPath,
  extensionTestsPath,
  extensionTestsEnv: {
    GOAL_FIDELITY_REPORT_PATH: reportPath
  },
  launchArgs: [
    workspacePath,
    '--extensions-dir',
    isolatedExtensionsDir
  ]
})
