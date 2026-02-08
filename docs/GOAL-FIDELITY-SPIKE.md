# Goal Fidelity Spike (v0.4.1)

## Scope
- Goal: measure real `goal != null` fill rate on Lean samples.
- Runner: `pnpm test:spike:goal-fidelity`
- Report output: `reports/goal-fidelity-report.json`
- Measured at: `2026-02-08T06:00:31.358Z`

## Environment
- VS Code test runtime: `1.109.0`
- Lean extension: `leanprover.lean4` `0.0.221`
- Lean toolchain: `4.27.0`
- Workspace under test: `samples/goal-fidelity`

## Result
- Total nodes: `3`
- Nodes with goal text: `3`
- Coverage: `100.0%`

Per sample:
- `GoalFidelitySamples/Basic.lean`: `1 / 1` (`100.0%`)
- `GoalFidelitySamples/MathlibSample.lean`: `1 / 1` (`100.0%`)
- `GoalFidelitySamples/StableOnly.lean`: `1 / 1` (`100.0%`)

## Signal Breakdown
- `stableHints`: `4`
- `declarationHints`: `3`
- `diagnosticHints`: `0`
- `hoverHints`: `0`
- `apiHints`: `0`
- `commandHints`: `0`
- `stableHintRatio`: `57.1%`
- `fallbackHintRatio`: `42.9%`

Observed probe failures include:
- stable request에서 `No connection to Lean`와 `EMPTY_RESPONSE: nullish`가 혼재해 발생
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
- 샘플별 snapshot 정합성 보강(현재 파일 URI 일치 검사)으로 cross-file 측정 오염을 제거했다.
- `stable nullish` 관측 시 추가 안정화 대기 윈도우를 적용해 조기 fallback 확정을 완화했다.
- `StableOnly.lean`에서 stable source만으로 goal 채움이 확인됐다.
- `MathlibSample.lean`은 coverage는 확보됐지만 stable hint가 `0`이며 declaration fallback 의존 케이스가 남아 있다.

## Next Actions
1. Mathlib stable hint `0` 재현 시나리오를 fixture로 고정하고, `No connection` vs `nullish` 비율을 추적한다.
2. fallback 의존이 높아지는 릴리즈를 감지하는 CI 경보 기준을 유지한다.
