import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspaceRoot = new URL('..', import.meta.url).pathname

const walkFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath))
      continue
    }

    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.mel'))) {
      files.push(fullPath)
    }
  }

  return files
}

const readFiles = async (dir: string): Promise<Array<{ path: string; content: string }>> => {
  const files = await walkFiles(dir)
  return Promise.all(files.map(async (path) => ({
    path,
    content: await readFile(path, 'utf8')
  })))
}

const importMatches = (content: string): string[] => {
  const imports: string[] = []
  const regex = /from\s+['\"]([^'\"]+)['\"]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    imports.push(match[1] ?? '')
  }
  return imports
}

describe('Package boundary compliance', () => {
  it('schema package has no IO imports and no zod', async () => {
    const files = await readFiles(join(workspaceRoot, 'packages', 'schema'))

    for (const file of files) {
      if (file.path.endsWith('.mel')) {
        continue
      }

      const imports = importMatches(file.content)
      expect(imports.some((value) => value === 'zod')).toBe(false)
      expect(imports.some((value) => value === 'vscode')).toBe(false)
      expect(imports.some((value) => value.startsWith('node:'))).toBe(false)
      expect(imports.some((value) => value.startsWith('@proof-flow/host'))).toBe(false)
      expect(imports.some((value) => value.startsWith('@proof-flow/app'))).toBe(false)
    }
  })

  it('host package does not import @manifesto-ai/world', async () => {
    const files = await readFiles(join(workspaceRoot, 'packages', 'host'))

    for (const file of files) {
      const imports = importMatches(file.content)
      expect(imports.some((value) => value.startsWith('@manifesto-ai/world'))).toBe(false)
    }
  })

  it('app package does not import Lean LSP directly', async () => {
    const files = await readFiles(join(workspaceRoot, 'packages', 'app'))

    for (const file of files) {
      const imports = importMatches(file.content)
      expect(imports.some((value) => /lean/i.test(value))).toBe(false)
    }
  })
})
