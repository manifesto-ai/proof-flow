import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createAttemptRecordEffect,
  createAttemptSuggestEffect,
  isPatternEligibleTacticKey,
  type AttemptRecordInput
} from '../packages/host/src/index.js'

const FILE_URI = 'file:///baseline.lean'
const NODE_ID = 'goal-node'
const NOW = 1_700_000_000_500
const reportPath = resolve(process.cwd(), 'reports', 'g0-baseline-report.json')

type SuggestScenario = {
  id: string
  input: { fileUri: string; nodeId: string }
  expectedTop1: string
  expectedInTop3: string
  snapshotData: Record<string, unknown>
}

const scenarios: SuggestScenario[] = [
  {
    id: 'category-match-priority',
    input: { fileUri: FILE_URI, nodeId: NODE_ID },
    expectedTop1: 'simp',
    expectedInTop3: 'simp',
    snapshotData: {
      files: {
        [FILE_URI]: {
          dag: {
            nodes: {
              [NODE_ID]: {
                status: { errorCategory: 'TACTIC_FAILED' }
              }
            }
          }
        }
      },
      history: { files: {} },
      patterns: {
        entries: {
          'TACTIC_FAILED:simp': {
            errorCategory: 'TACTIC_FAILED',
            tacticKey: 'simp',
            successCount: 8,
            failureCount: 2,
            score: 0.8,
            lastUpdated: NOW
          },
          'OTHER:aesop': {
            errorCategory: 'OTHER',
            tacticKey: 'aesop',
            successCount: 9,
            failureCount: 1,
            score: 0.9,
            lastUpdated: NOW
          }
        }
      },
      suggestions: { version: '0.4.0', byNode: {}, updatedAt: null }
    }
  },
  {
    id: 'history-fallback-goalless',
    input: { fileUri: FILE_URI, nodeId: NODE_ID },
    expectedTop1: 'exact',
    expectedInTop3: 'exact',
    snapshotData: {
      files: {
        [FILE_URI]: {
          dag: {
            nodes: {
              [NODE_ID]: {
                status: { errorCategory: 'OTHER' }
              }
            }
          }
        }
      },
      history: {
        files: {
          [FILE_URI]: {
            nodes: {
              [NODE_ID]: {
                attempts: {
                  a1: { timestamp: 1, tacticKey: 'exact', result: 'success', contextErrorCategory: 'OTHER' },
                  a2: { timestamp: 2, tacticKey: 'exact', result: 'success', contextErrorCategory: 'OTHER' },
                  a3: { timestamp: 3, tacticKey: 'exact', result: 'error', contextErrorCategory: 'OTHER' },
                  a4: { timestamp: 4, tacticKey: 'aesop', result: 'error', contextErrorCategory: 'OTHER' },
                  a5: { timestamp: 5, tacticKey: 'aesop', result: 'error', contextErrorCategory: 'OTHER' }
                }
              }
            }
          }
        }
      },
      patterns: { entries: {} },
      suggestions: { version: '0.4.0', byNode: {}, updatedAt: null }
    }
  },
  {
    id: 'recency-and-node-local',
    input: { fileUri: FILE_URI, nodeId: NODE_ID },
    expectedTop1: 'simp',
    expectedInTop3: 'simp',
    snapshotData: {
      files: {
        [FILE_URI]: {
          dag: {
            nodes: {
              [NODE_ID]: {
                status: { errorCategory: 'TACTIC_FAILED' }
              }
            }
          }
        }
      },
      history: {
        files: {
          [FILE_URI]: {
            nodes: {
              [NODE_ID]: {
                attempts: {
                  a1: { timestamp: NOW - 30, tacticKey: 'simp', result: 'success', contextErrorCategory: 'TACTIC_FAILED' },
                  a2: { timestamp: NOW - 25, tacticKey: 'simp', result: 'success', contextErrorCategory: 'TACTIC_FAILED' },
                  a3: { timestamp: NOW - 20, tacticKey: 'simp', result: 'success', contextErrorCategory: 'TACTIC_FAILED' },
                  a4: { timestamp: NOW - 15, tacticKey: 'exact', result: 'error', contextErrorCategory: 'TACTIC_FAILED' },
                  a5: { timestamp: NOW - 10, tacticKey: 'exact', result: 'error', contextErrorCategory: 'TACTIC_FAILED' }
                }
              }
            }
          }
        }
      },
      patterns: {
        entries: {
          'TACTIC_FAILED:exact': {
            errorCategory: 'TACTIC_FAILED',
            tacticKey: 'exact',
            successCount: 9,
            failureCount: 1,
            score: 0.9,
            lastUpdated: NOW - (1000 * 60 * 60 * 24 * 60)
          },
          'TACTIC_FAILED:simp': {
            errorCategory: 'TACTIC_FAILED',
            tacticKey: 'simp',
            successCount: 8,
            failureCount: 2,
            score: 0.8,
            lastUpdated: NOW - 100
          }
        }
      },
      suggestions: { version: '0.4.0', byNode: {}, updatedAt: null }
    }
  }
]

const applySetPatches = (
  state: Record<string, unknown>,
  patches: Array<{ op: string; path: string; value?: unknown }>
): void => {
  for (const patch of patches) {
    if (patch.op !== 'set') {
      continue
    }

    if (patch.path === 'history') {
      state.history = patch.value
    }
    else if (patch.path === 'patterns') {
      state.patterns = patch.value
    }
    else if (patch.path === 'suggestions') {
      state.suggestions = patch.value
    }
  }
}

describe('g0 recommendation baseline runner', () => {
  it('writes goalless baseline report and enforces minimum quality gates', async () => {
    const suggestEffect = createAttemptSuggestEffect({
      now: () => NOW,
      minSampleSize: 2,
      limit: 5,
      ttlMs: 1000 * 60 * 30,
      maxTrackedNodes: 64
    })

    const scenarioResults = []
    for (const scenario of scenarios) {
      const patches = await suggestEffect(scenario.input, {
        snapshot: { data: scenario.snapshotData }
      })
      const suggestions = ((patches[0] as { value?: any })?.value?.byNode?.[NODE_ID] ?? []) as Array<{ tacticKey: string }>
      const top1 = suggestions[0]?.tacticKey ?? null
      const top3 = suggestions.slice(0, 3).map((entry) => entry.tacticKey)

      scenarioResults.push({
        id: scenario.id,
        expectedTop1: scenario.expectedTop1,
        expectedInTop3: scenario.expectedInTop3,
        top1,
        top3,
        suggestionCount: suggestions.length,
        top1Matched: top1 === scenario.expectedTop1,
        top3Matched: top3.includes(scenario.expectedInTop3)
      })
    }

    const total = scenarioResults.length
    const top1Hits = scenarioResults.filter((entry) => entry.top1Matched).length
    const top3Hits = scenarioResults.filter((entry) => entry.top3Matched).length
    const covered = scenarioResults.filter((entry) => entry.suggestionCount > 0).length
    const averageSuggestionCount = scenarioResults.reduce((sum, entry) => sum + entry.suggestionCount, 0) / total

    const attemptQualityInputs: AttemptRecordInput[] = [
      {
        fileUri: FILE_URI,
        nodeId: NODE_ID,
        tactic: 'simp',
        tacticKey: 'simp',
        result: 'success',
        contextErrorCategory: 'OTHER',
        errorMessage: null,
        durationMs: 10
      },
      {
        fileUri: FILE_URI,
        nodeId: NODE_ID,
        tactic: 'auto:lemma',
        tacticKey: 'auto:lemma',
        result: 'error',
        contextErrorCategory: 'TACTIC_FAILED',
        errorMessage: 'auto marker',
        durationMs: 11
      },
      {
        fileUri: FILE_URI,
        nodeId: NODE_ID,
        tactic: 'exact',
        tacticKey: 'exact',
        result: 'success',
        contextErrorCategory: 'TACTIC_FAILED',
        errorMessage: null,
        durationMs: 12
      },
      {
        fileUri: FILE_URI,
        nodeId: NODE_ID,
        tactic: 'have h := x',
        tacticKey: 'have h := x',
        result: 'error',
        contextErrorCategory: 'OTHER',
        errorMessage: 'non canonical key',
        durationMs: 13
      }
    ]

    const recordEffect = createAttemptRecordEffect({
      now: (() => {
        let tick = NOW
        return () => {
          tick += 1
          return tick
        }
      })()
    })
    const rollingState: Record<string, unknown> = {}

    let filteredFromPatterns = 0
    let acceptedAttempts = 0
    for (const input of attemptQualityInputs) {
      const patches = await recordEffect(input, {
        snapshot: { data: rollingState }
      })
      if (patches.length === 0) {
        continue
      }

      acceptedAttempts += 1
      const hasPatternsPatch = patches.some((patch) => patch.op === 'set' && patch.path === 'patterns')
      if (!hasPatternsPatch) {
        filteredFromPatterns += 1
      }
      applySetPatches(rollingState, patches as Array<{ op: string; path: string; value?: unknown }>)
    }

    const lowQualityAttempts = attemptQualityInputs.filter((input) => !isPatternEligibleTacticKey(input.tacticKey)).length
    const lowQualityRate = acceptedAttempts > 0 ? lowQualityAttempts / acceptedAttempts : 0

    const report = {
      measuredAt: new Date().toISOString(),
      mode: 'G0',
      recommendationMetrics: {
        scenarios: total,
        coverageRate: covered / total,
        top1Accuracy: top1Hits / total,
        top3Recall: top3Hits / total,
        averageSuggestionCount
      },
      attemptQuality: {
        acceptedAttempts,
        lowQualityAttempts,
        lowQualityRate,
        filteredFromPatterns,
        filterPolicy: {
          rejects: ['auto-prefix', 'whitespace-in-key', 'excessive-length'],
          note: 'history는 유지하고 patterns만 제외'
        }
      },
      g1DeltaDefinition: {
        top1Lift: 'G1.top1Accuracy - G0.top1Accuracy',
        top3Lift: 'G1.top3Recall - G0.top3Recall',
        coverageLift: 'G1.coverageRate - G0.coverageRate',
        qualityLift: 'G1.lowQualityRate - G0.lowQualityRate (lower-is-better)'
      },
      scenarios: scenarioResults
    }

    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

    expect(report.recommendationMetrics.coverageRate).toBe(1)
    expect(report.recommendationMetrics.top1Accuracy).toBeGreaterThanOrEqual(2 / 3)
    expect(report.recommendationMetrics.top3Recall).toBe(1)
    expect(report.attemptQuality.filteredFromPatterns).toBe(lowQualityAttempts)
  })
})
