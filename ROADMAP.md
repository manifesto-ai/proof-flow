# ProofFlow Roadmap

## Status Snapshot (2026-02-08)
- ✅ Workspace scaffold (pnpm + ESM + TS configs)
- ✅ MEL domain (compiler-compatible) authored
- ✅ Docs updated for underscore action/effect names
- ✅ Core intent tests written (MEL injected)
- ✅ Tests re-run on Manifesto latest (`@manifesto-ai/*` 2.2.x)
- ✅ App wiring baseline (effects-first AppConfig + extension lifecycle)
- ✅ Custom World adapter baseline (persisted MemoryWorldStore)
- ✅ Host effect implementation (`dag.extract` parser + validation pipeline)
- ✅ Lineage/replay invariants test baseline
- ✅ Projection-only UI enhanced (WebView projection + search/filter/sort + virtual list)
- ✅ VS Code extension E2E flow test baseline (event → app.act / command toggle)
- ✅ App initialData hardening (root state fields retained after runtime actions)
- ✅ WorldStore replay hardening (dot-safe URI key restore for `data.files`)
- ✅ VS Code smoke runner baseline (`pnpm test:smoke:vscode`)
- ✅ Minimal CI workflow baseline (`test`, `typecheck`, `build`)
- ✅ v0.2 attempt domain contract (`attempt_record`, `history_clear`, `patterns_reset`)
- ✅ Host attempt aggregation effect (`proof_flow.attempt.record`) + unit tests
- ✅ Extension attempt trigger baseline (save/diagnostics → deduped `attempt_record`)
- ✅ Projection read model v0.2 (`attemptOverview`, `selectedNodeHistory`, `patternInsights`)
- ✅ Attempt world replay/restore verification (`tests/attempt-replay.spec.ts`)
- ✅ Projection read model v0.3 (`nodeHeatmap`, qualified pattern ranking, dashboard)
- ✅ Pattern reset UX wiring (WebView button + command palette `proof-flow.patternsReset`)
- ✅ WorldStore dynamic-key replay hardening (`history.files.*`, `patterns.entries.*`)

## Checkpoints

### 0. Foundation
- [x] pnpm workspace + ESM + TS build pipeline
- [x] Package scaffold (`packages/schema`, `packages/host`, `packages/app`)
- [x] ESLint baseline (`@antfu/eslint-config`)

### 1. Domain (MEL)
- [x] `domain.mel` v0.1 (compiler-compatible: underscore names)
- [x] Update docs to match MEL grammar
- [x] Run `pnpm test` to validate domain behaviors

### 2. App Skeleton (Manifesto v2.2+)
- [x] AppConfig wiring (MEL text injection + `effects` map)
- [x] Stable initialData contract for runtime bootstrap
- [x] Custom World adapter (optional, world-owned persistence)
- [x] Actor/Authority policy (single-actor auto-approve)
- [x] VS Code lifecycle wiring (`activate`/`ready`/`app.act`/`deactivate`)

### 3. Host Effects (IO Boundary)
- [x] `proof_flow.dag.extract` (Lean diagnostics + DAG parse + Zod validation)
- [x] `proof_flow.editor.reveal` baseline (range reveal via snapshot node lookup)
- [x] `proof_flow.editor.getCursor` baseline (cursor -> nodeId patch)

### 4. Tests
- [x] Core intent flow tests (dag_sync, file_activate, node_select, ui toggles)
- [x] Effect handler tests (host → patches)
- [x] World lineage/replay tests (determinism + storage integrity)
- [x] VS Code extension E2E flow tests (activate/events/command/deactivate)
- [x] App config regression test (root state preservation)
- [x] WorldStore regression test (URI dotted path replay integrity)

### 5. Projection-Only UI (최후순위)
- [x] Read-only projection from `Snapshot.data` and `Snapshot.computed`
- [x] DAG view + summary metrics (no domain logic in UI)
- [x] Node search / status filter / sort controls
- [x] Virtualized list rendering for large DAGs

### 6. DevOps
- [x] CI baseline (`pnpm test`, `pnpm typecheck`, `pnpm build`)
- [x] VS Code smoke command for manual/runtime validation (`pnpm test:smoke:vscode`)

### 7. v0.2 Attempt/Pattern Skeleton
- [x] MEL action contract (`attempt_record`) and reset actions (`history_clear`, `patterns_reset`)
- [x] Typed schema for `AttemptRecord`, `HistoryState`, `PatternEntry`
- [x] Host effect `proof_flow.attempt.record` with atomic `history`/`patterns` update
- [x] Host/domain test coverage for attempt accumulation + streak/score update
- [x] Extension trigger wiring baseline (save/diagnostics 후 active node 상태를 attempt로 기록, fingerprint dedupe)
- [x] Projection read model: node attempt summary / pattern insight selector
- [x] E2E scenario: attempt 생성 후 world replay/복원 검증

### 8. v0.3 Projection/Replay Hardening
- [x] Projection 모델 확장: `attemptCount/heatLevel`, `nodeHeatmap`, dashboard 집계
- [x] Qualified pattern 기준(sample >= 3) + selected category 우선 인사이트 노출
- [x] WebView resetPatterns 메시지 처리 + extension 액션 연결
- [x] Command palette reset 경로 추가 (`proof-flow.patternsReset`)
- [x] Extension E2E: reset command/panel action -> `patterns_reset` 디스패치 검증
- [x] WorldStore 회귀 테스트: 점(`.`) 포함 dynamic key 경로(`history`, `patterns`) 복원 무결성 검증
