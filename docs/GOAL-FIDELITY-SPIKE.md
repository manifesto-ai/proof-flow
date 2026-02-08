# Goal Fidelity Spike (v0.4.1)

## Scope
- Goal: measure real `goal != null` fill rate on Lean samples, not just unit mocks.
- Runner: `pnpm test:spike:goal-fidelity`
- Report output: `reports/goal-fidelity-report.json`
- Measured at: `2026-02-08T04:21:01.154Z`

## Environment
- VS Code test runtime: `1.109.0`
- Lean extension: `leanprover.lean4` `0.0.221`
- Lean toolchain: `4.27.0`
- Samples:
  - `samples/goal-fidelity/GoalFidelitySamples/Basic.lean`
  - `samples/goal-fidelity/GoalFidelitySamples/MathlibSample.lean`

## Result
- Total nodes: `2`
- Nodes with goal text: `0`
- Coverage: `0.0%`

Per sample:
- `Basic.lean`: `0 / 1` (`0.0%`)
- `MathlibSample.lean`: `0 / 1` (`0.0%`)

Source counters (both samples): all zero
- `stableHints`: `0`
- `diagnosticHints`: `0`
- `hoverHints`: `0`
- `apiHints`: `0`
- `commandHints`: `0`

## Interpretation
- DAG extraction path is alive (nodes are produced).
- Goal source pipeline is not producing usable goal text in this real run.
- Current product value remains closer to structure/error navigation than goal-aware guidance.

## Notable Runner Fixes
- The spike runner now uses a Lean-only isolated extensions directory to avoid unrelated extension crashes.
- The spike workspace is set to repo root because extension bootstrap currently reads schema from `packages/schema/domain.mel`.

## Next Actions (P0 Recovery)
1. Add readiness gating before snapshot (Lean server warm-up + diagnostics settled).
2. Log probe-level failures per source (`stable/diagnostic/hover/api/command`) for root-cause visibility.
3. Add one failing fixture that should return a concrete goal string and assert non-zero coverage in CI.
4. Decouple schema loading from workspace root path so the extension can run from arbitrary Lean workspaces.
