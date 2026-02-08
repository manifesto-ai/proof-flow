# ProofFlow Roadmap

## Status Snapshot (2026-02-07)
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

### 5. Projection-Only UI (최후순위)
- [x] Read-only projection from `Snapshot.data` and `Snapshot.computed`
- [x] DAG view + summary metrics (no domain logic in UI)
- [x] Node search / status filter / sort controls
- [x] Virtualized list rendering for large DAGs
