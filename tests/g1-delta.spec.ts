import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAttemptSuggestEffect } from '../packages/host/src/index.js'

const FILE_URI = 'file:///g1-baseline.lean'
const NODE_ID = 'goal-node'
const NOW = 1_700_100_000_000
const reportPath = resolve(process.cwd(), 'reports', 'g1-delta-report.json')

type Scenario = {
  id: string
  category: 'OTHER' | 'TACTIC_FAILED' | 'UNSOLVED_GOALS'
  goalText: string
  targetTop1: string
  targetInTop3: string
  patternEntries: Record<string, unknown>
}

const scenarios: Scenario[] = [
  {
    id: 'goal-match-flips-exact-to-simp',
    category: 'TACTIC_FAILED',
    goalText: '⊢ n + 0 = n',
    targetTop1: 'simp',
    targetInTop3: 'simp',
    patternEntries: {
      'TACTIC_FAILED:exact': {
        errorCategory: 'TACTIC_FAILED',
        tacticKey: 'exact',
        successCount: 8,
        failureCount: 2,
        score: 0.8,
        lastUpdated: NOW - 100,
        goalSignature: 'a + 0 = a'
      },
      'TACTIC_FAILED:simp': {
        errorCategory: 'TACTIC_FAILED',
        tacticKey: 'simp',
        successCount: 74,
        failureCount: 26,
        score: 0.74,
        lastUpdated: NOW - 100,
        goalSignature: 'n + 0 = n'
      }
    }
  },
  {
    id: 'control-top1-stays-rw',
    category: 'OTHER',
    goalText: '⊢ x = y',
    targetTop1: 'rw',
    targetInTop3: 'rw',
    patternEntries: {
      'OTHER:rw': {
        errorCategory: 'OTHER',
        tacticKey: 'rw',
        successCount: 17,
        failureCount: 3,
        score: 0.85,
        lastUpdated: NOW - 50,
        goalSignature: 'x = y'
      },
      'OTHER:simp': {
        errorCategory: 'OTHER',
        tacticKey: 'simp',
        successCount: 10,
        failureCount: 10,
        score: 0.5,
        lastUpdated: NOW - 50,
        goalSignature: 'x = y'
      }
    }
  },
  {
    id: 'goal-match-flips-nlinarith-to-linarith',
    category: 'UNSOLVED_GOALS',
    goalText: '⊢ a <= b',
    targetTop1: 'linarith',
    targetInTop3: 'linarith',
    patternEntries: {
      'UNSOLVED_GOALS:nlinarith': {
        errorCategory: 'UNSOLVED_GOALS',
        tacticKey: 'nlinarith',
        successCount: 79,
        failureCount: 21,
        score: 0.79,
        lastUpdated: NOW - 200,
        goalSignature: '0 <= a'
      },
      'UNSOLVED_GOALS:linarith': {
        errorCategory: 'UNSOLVED_GOALS',
        tacticKey: 'linarith',
        successCount: 73,
        failureCount: 27,
        score: 0.73,
        lastUpdated: NOW - 200,
        goalSignature: 'a <= b'
      }
    }
  }
]

const makeSnapshot = (
  scenario: Scenario,
  mode: 'g0' | 'g1'
): Record<string, unknown> => ({
  files: {
    [FILE_URI]: {
      dag: {
        nodes: {
          [NODE_ID]: {
            goal: mode === 'g1' ? scenario.goalText : null,
            status: {
              errorCategory: scenario.category
            }
          }
        }
      }
    }
  },
  history: { files: {} },
  patterns: {
    entries: scenario.patternEntries
  },
  suggestions: {
    version: '0.4.0',
    byNode: {},
    updatedAt: null
  }
})

type ScenarioResult = {
  id: string
  targetTop1: string
  targetInTop3: string
  top1: string | null
  top3: string[]
  suggestionCount: number
  top1Matched: boolean
  top3Matched: boolean
}

const summarize = (results: ScenarioResult[]) => {
  const total = results.length
  const top1Hits = results.filter((entry) => entry.top1Matched).length
  const top3Hits = results.filter((entry) => entry.top3Matched).length
  const covered = results.filter((entry) => entry.suggestionCount > 0).length
  const averageSuggestionCount = total > 0
    ? results.reduce((sum, entry) => sum + entry.suggestionCount, 0) / total
    : 0

  return {
    scenarios: total,
    coverageRate: total > 0 ? covered / total : 0,
    top1Accuracy: total > 0 ? top1Hits / total : 0,
    top3Recall: total > 0 ? top3Hits / total : 0,
    averageSuggestionCount
  }
}

describe('g1 delta runner', () => {
  it('writes G1 delta report from stable-source off/on A/B', async () => {
    const suggestEffect = createAttemptSuggestEffect({
      now: () => NOW,
      minSampleSize: 2,
      limit: 5,
      ttlMs: 1000 * 60 * 30,
      maxTrackedNodes: 64
    })

    const g0Results: ScenarioResult[] = []
    const g1Results: ScenarioResult[] = []

    for (const scenario of scenarios) {
      const g0Patches = await suggestEffect({ fileUri: FILE_URI, nodeId: NODE_ID }, {
        snapshot: { data: makeSnapshot(scenario, 'g0') }
      })
      const g1Patches = await suggestEffect({ fileUri: FILE_URI, nodeId: NODE_ID }, {
        snapshot: { data: makeSnapshot(scenario, 'g1') }
      })

      const g0Suggestions = ((g0Patches[0] as { value?: any })?.value?.byNode?.[NODE_ID] ?? []) as Array<{ tacticKey: string }>
      const g1Suggestions = ((g1Patches[0] as { value?: any })?.value?.byNode?.[NODE_ID] ?? []) as Array<{ tacticKey: string }>
      const g0Top3 = g0Suggestions.slice(0, 3).map((entry) => entry.tacticKey)
      const g1Top3 = g1Suggestions.slice(0, 3).map((entry) => entry.tacticKey)
      const g0Top1 = g0Top3[0] ?? null
      const g1Top1 = g1Top3[0] ?? null

      g0Results.push({
        id: scenario.id,
        targetTop1: scenario.targetTop1,
        targetInTop3: scenario.targetInTop3,
        top1: g0Top1,
        top3: g0Top3,
        suggestionCount: g0Suggestions.length,
        top1Matched: g0Top1 === scenario.targetTop1,
        top3Matched: g0Top3.includes(scenario.targetInTop3)
      })
      g1Results.push({
        id: scenario.id,
        targetTop1: scenario.targetTop1,
        targetInTop3: scenario.targetInTop3,
        top1: g1Top1,
        top3: g1Top3,
        suggestionCount: g1Suggestions.length,
        top1Matched: g1Top1 === scenario.targetTop1,
        top3Matched: g1Top3.includes(scenario.targetInTop3)
      })
    }

    const g0Metrics = summarize(g0Results)
    const g1Metrics = summarize(g1Results)
    const lift = {
      top1Lift: g1Metrics.top1Accuracy - g0Metrics.top1Accuracy,
      top3Lift: g1Metrics.top3Recall - g0Metrics.top3Recall,
      coverageLift: g1Metrics.coverageRate - g0Metrics.coverageRate
    }

    const report = {
      measuredAt: new Date().toISOString(),
      mode: {
        g0: 'stable-source-off (goal unavailable)',
        g1: 'stable-source-on (goal available)'
      },
      g0: {
        metrics: g0Metrics,
        scenarios: g0Results
      },
      g1: {
        metrics: g1Metrics,
        scenarios: g1Results
      },
      lift,
      notes: [
        'G0/G1는 같은 pattern/history를 사용하고 active node goal availability만 다르게 둔다.',
        'stable source on/off A/B를 goal availability 실험으로 대체한 deterministic runner다.'
      ]
    }

    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

    expect(g0Metrics.coverageRate).toBe(1)
    expect(g1Metrics.coverageRate).toBe(1)
    expect(g1Metrics.top1Accuracy).toBeGreaterThan(g0Metrics.top1Accuracy)
    expect(lift.top1Lift).toBeGreaterThan(0)
  })
})
