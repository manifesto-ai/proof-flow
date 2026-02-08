# Goal Fidelity Spike (v0.4.1)

## Scope
- Goal: measure real `goal != null` fill rate on Lean samples.
- Runner: `pnpm test:spike:goal-fidelity`
- Report output: `reports/goal-fidelity-report.json`
- Measured at: `2026-02-08T04:39:04.622Z`

## Environment
- VS Code test runtime: `1.109.0`
- Lean extension: `leanprover.lean4` `0.0.221`
- Lean toolchain: `4.27.0`
- Workspace under test: `samples/goal-fidelity`

## Result
- Total nodes: `3`
- Nodes with goal text: `2`
- Coverage: `66.7%`

Per sample:
- `GoalFidelitySamples/Basic.lean`: `1 / 1` (`100.0%`)
- `GoalFidelitySamples/MathlibSample.lean`: `1 / 2` (`50.0%`)

## Signal Breakdown
- `stableHints`: `0`
- `declarationHints`: `3`
- `diagnosticHints`: `0`
- `hoverHints`: `0`
- `apiHints`: `0`
- `commandHints`: `0`

Observed probe failures include:
- stable request race (`No connection to Lean`) during early startup windows
- Lean API surface discovery miss (`API_METHODS_UNAVAILABLE`)
- info view command shape mismatch for some command probes

## Interpretation
- P0 recovery objectives are implemented:
  - schema loading decoupled from workspace root
  - readiness gate before snapshot
  - probe failure diagnostics in snapshot/report
  - CI guardrail: at least one sample must have `withGoal > 0`
- Current non-zero coverage is mostly from declaration-goal fallback.
- Stable Lean goal endpoints are still not contributing (`stableHints = 0`), so fidelity quality remains partially degraded.

## Next Actions
1. Add stable-source success-rate KPI and alert when fallback ratio dominates.
2. Increase startup retry strategy for `$/lean/plainGoal` transport race windows.
3. Narrow command probing to known-safe signatures to reduce noisy failures.
4. Add one fixture that expects stable-source hints (not declaration fallback) for stricter quality gating.
