# Goal Fidelity Spike (v0.4.1)

## Scope
- Goal: measure real `goal != null` fill rate on Lean samples.
- Runner: `pnpm test:spike:goal-fidelity`
- Report output: `reports/goal-fidelity-report.json`
- Measured at: `2026-02-08T05:24:09.750Z`

## Environment
- VS Code test runtime: `1.109.0`
- Lean extension: `leanprover.lean4` `0.0.221`
- Lean toolchain: `4.27.0`
- Workspace under test: `samples/goal-fidelity`

## Result
- Total nodes: `4`
- Nodes with goal text: `3`
- Coverage: `75.0%`

Per sample:
- `GoalFidelitySamples/Basic.lean`: `1 / 1` (`100.0%`)
- `GoalFidelitySamples/MathlibSample.lean`: `1 / 2` (`50.0%`)
- `GoalFidelitySamples/StableOnly.lean`: `1 / 1` (`100.0%`)

## Signal Breakdown
- `stableHints`: `9`
- `declarationHints`: `3`
- `diagnosticHints`: `0`
- `hoverHints`: `0`
- `apiHints`: `0`
- `commandHints`: `0`
- `stableHintRatio`: `75.0%`
- `fallbackHintRatio`: `25.0%`

Observed probe failures include:
- `$/lean/plainGoal` / `$/lean/plainTermGoal`가 일부 위치에서 `null` payload를 반환(`EMPTY_RESPONSE: nullish`)
- Lean API surface discovery miss (`API_METHODS_UNAVAILABLE`)
- command registry에서 safe goal command 미발견(`COMMANDS_UNAVAILABLE`)

## Interpretation
- P0 recovery objectives are implemented:
  - schema loading decoupled from workspace root
  - readiness gate before snapshot
  - probe failure diagnostics in snapshot/report
  - CI guardrail: at least one sample must have `withGoal > 0`
- Goal coverage snapshot/report now includes source KPI and fallback-dominance alerts.
- Stable request 재시도 + safe command probe 축소 + stable-only fixture gate가 반영됐다.
- `StableOnly.lean`에서 stable source만으로 goal 채움이 확인됐다.
- `MathlibSample.lean`은 `leanClientReady=true`에서도 stable API 응답이 반복적으로 `nullish`라 stable hint가 `0`이며 fallback 의존 케이스가 남아 있다.

## Next Actions
1. Mathlib 샘플에서 stable API가 `null`을 반환하는 조건(포지션/시점/문맥)을 분리 계측하고, 가능한 대체 포지션 전략을 추가한다.
2. 안정화된 KPI를 기준으로 P1(추천 품질/상태 위생) 작업을 진행한다.
