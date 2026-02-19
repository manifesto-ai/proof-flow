import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('..', import.meta.url).pathname

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath))
      continue
    }

    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.mel'))) {
      files.push(fullPath)
    }
  }

  return files
}

const readDirFiles = async (dir: string): Promise<Array<{ path: string; content: string }>> => {
  const files = await walk(dir)
  return Promise.all(files.map(async (path) => ({ path, content: await readFile(path, 'utf8') })))
}

describe('Forbidden patterns', () => {
  it('FORBID-1/2: no direct snapshot mutation or external state managers', async () => {
    const files = await readDirFiles(join(root, 'packages'))

    for (const file of files) {
      const content = file.content
      expect(/snapshot\.data\.[^\n]*=/.test(content)).toBe(false)
      expect(/snapshot\.computed\.[^\n]*=/.test(content)).toBe(false)
      expect(/from\s+['\"]react['\"]/.test(content)).toBe(false)
      expect(/from\s+['\"]zustand['\"]/.test(content)).toBe(false)
      expect(/from\s+['\"]@reduxjs\//.test(content)).toBe(false)
    }
  })

  it('FORBID-4/8: host handlers do not embed domain policy and never use fileUri as path segment', async () => {
    const files = await readDirFiles(join(root, 'packages', 'host', 'src', 'effects'))

    for (const file of files) {
      const content = file.content
      expect(/metrics\./.test(content)).toBe(false)
      expect(/path:\s*`files\.\$\{/.test(content)).toBe(false)
      expect(/path:\s*['\"]files\./.test(content)).toBe(false)
    }
  })

  it('FORBID-5/6/7/10: no bypass calls, custom event system, or hand-written core IR', async () => {
    const appAndSchema = await readDirFiles(join(root, 'packages', 'app'))
    const schemaFiles = await readDirFiles(join(root, 'packages', 'schema'))
    const files = [...appAndSchema, ...schemaFiles]

    for (const file of files) {
      const content = file.content
      expect(/host\.dispatch\(/.test(content)).toBe(false)
      expect(/core\.compute\(/.test(content)).toBe(false)
      expect(/EventEmitter/.test(content)).toBe(false)
      expect(/FlowNode/.test(content)).toBe(false)
      expect(/kind:\s*['\"]seq['\"]/.test(content)).toBe(false)
      expect(/history\.json/.test(content)).toBe(false)
    }
  })

  it('FORBID-9: MEL effects are guarded by once*/intent guards', async () => {
    const mel = await readFile(join(root, 'packages', 'schema', 'domain.mel'), 'utf8')
    const lines = mel.split(/\r?\n/)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (!line.includes('effect lean.')) {
        continue
      }

      const windowStart = Math.max(0, i - 6)
      const context = lines.slice(windowStart, i + 1).join('\n')
      expect(context.includes('onceIntent') || context.includes('once(')).toBe(true)
    }
  })

  it('FORBID-12: no @manifesto-ai/app imports in runtime source/tests', async () => {
    const appFiles = await readDirFiles(join(root, 'packages', 'app', 'src'))
    const testFiles = await readDirFiles(join(root, 'tests'))

    const allFiles = [...appFiles, ...testFiles]
    for (const file of allFiles) {
      if (file.path.includes('forbidden.spec.ts')) {
        continue
      }

      expect(file.content.includes('@manifesto-ai/app')).toBe(false)
    }
  })
})
