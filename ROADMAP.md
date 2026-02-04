# ProofFlow Roadmap

## Status Snapshot (2026-02-04)
- ✅ Workspace scaffold (pnpm + ESM + TS configs)
- ✅ MEL domain (compiler-compatible) authored
- ✅ Docs updated for underscore action/effect names
- ✅ Core intent tests written (MEL injected)
- ⏳ Tests executed
- ⏳ App/Host/World wiring
- ⏳ Host effect implementation (Lean LSP + DAG extract)
- ⏳ Projection-only UI integration

## Checkpoints

### 0. Foundation
- [x] pnpm workspace + ESM + TS build pipeline
- [x] Package scaffold (`packages/schema`, `packages/host`, `packages/app`)
- [x] ESLint baseline (`@antfu/eslint-config`)

### 1. Domain (MEL)
- [x] `domain.mel` v0.1 (compiler-compatible: underscore names)
- [x] Update docs to match MEL grammar
- [ ] Run `pnpm test` to validate domain behaviors

### 2. App/Host/World Skeleton
- [ ] AppConfig wiring (MEL text injection + Host + WorldStore)
- [ ] WorldStore implementation (local filesystem, delta + checkpoint)
- [ ] Actor/Authority policy (single-actor auto-approve)

### 3. Host Effects (IO Boundary)
- [ ] `proof_flow.dag.extract` (Lean LSP + DAG parse + Zod validation)
- [ ] `proof_flow.editor.reveal` (VS Code reveal)
- [ ] `proof_flow.editor.getCursor` (VS Code cursor state)

### 4. Tests
- [x] Core intent flow tests (dag_sync, file_activate, node_select, ui toggles)
- [ ] Effect handler tests (host → patches)
- [ ] World lineage/replay tests (determinism + storage integrity)

### 5. Projection-Only UI (최후순위)
- [ ] Read-only projection from `Snapshot.data` and `Snapshot.computed`
- [ ] DAG view + summary metrics (no domain logic in UI)
