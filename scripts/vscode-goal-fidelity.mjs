import path from 'node:path'
import process from 'node:process'
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { runTests } from '@vscode/test-electron'

const workspacePath = process.cwd()
const extensionDevelopmentPath = path.resolve(workspacePath, 'packages/app')
const extensionTestsPath = path.resolve(workspacePath, 'scripts/vscode-goal-fidelity-suite.cjs')
const leanWorkspacePath = path.resolve(workspacePath, 'samples/goal-fidelity')
const reportPath = path.resolve(workspacePath, 'reports/goal-fidelity-report.json')
const defaultExtensionsDir = path.resolve(process.env.HOME ?? '', '.vscode/extensions')
const isolatedExtensionsDir = path.resolve(workspacePath, '.vscode-test/extensions-goal-fidelity')

const resolveLatestExtensionDir = async (extensionId) => {
  const entries = await readdir(defaultExtensionsDir, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => entry.isDirectory() && (entry.name === extensionId || entry.name.startsWith(`${extensionId}-`)))
    .map((entry) => entry.name)
    .sort()

  return candidates.length > 0 ? candidates[candidates.length - 1] : null
}

const prepareLeanOnlyExtensionsDir = async () => {
  const leanExtensionDir = await resolveLatestExtensionDir('leanprover.lean4')
  if (!leanExtensionDir) {
    throw new Error(
      `Lean extension not found in ${defaultExtensionsDir}. Install with: code --install-extension leanprover.lean4`
    )
  }

  await rm(isolatedExtensionsDir, { recursive: true, force: true })
  await mkdir(isolatedExtensionsDir, { recursive: true })

  const queue = [leanExtensionDir]
  const copied = new Set()

  while (queue.length > 0) {
    const extensionDirName = queue.shift()
    if (!extensionDirName || copied.has(extensionDirName)) {
      continue
    }

    const source = path.resolve(defaultExtensionsDir, extensionDirName)
    const target = path.resolve(isolatedExtensionsDir, extensionDirName)
    await cp(source, target, { recursive: true })
    copied.add(extensionDirName)

    const packageJsonPath = path.resolve(source, 'package.json')
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    const dependencies = Array.isArray(packageJson.extensionDependencies)
      ? packageJson.extensionDependencies
      : []

    for (const dependencyId of dependencies) {
      const dependencyDir = await resolveLatestExtensionDir(String(dependencyId))
      if (dependencyDir && !copied.has(dependencyDir)) {
        queue.push(dependencyDir)
      }
    }
  }
}

await prepareLeanOnlyExtensionsDir()

await runTests({
  extensionDevelopmentPath,
  extensionTestsPath,
  extensionTestsEnv: {
    GOAL_FIDELITY_REPORT_PATH: reportPath
  },
  launchArgs: [
    leanWorkspacePath,
    '--extensions-dir',
    isolatedExtensionsDir
  ]
})
