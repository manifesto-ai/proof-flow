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
- ✅ v0.4 prep 문서화 (`docs/V0.4-PREP.md`)
- ✅ v0.4 suggestion domain contract (`attempt_suggest`, `suggestions_clear`, `SuggestionState`)
- ✅ Host suggestion effect baseline (`proof_flow.attempt.suggest`) + deterministic ranking tests
- ✅ Suggestion projection/extension wiring (`selectedNodeSuggestions`, `proof-flow.suggestTactics`)
- ✅ v0.4.1 stable goal source integration (`$/lean/plainGoal`, `$/lean/plainTermGoal`) + source stats
- ✅ v0.4.2 closed-loop baseline (`attempt_apply` effect + panel apply + post-apply re-suggest)
- ✅ v0.4.2 Suggestion closed loop integration test (`tests/suggestion-closed-loop.spec.ts`)
- ✅ v0.4.3 Start-Here triage (priority queue + panel + tests)
- ✅ v0.4.1 P0 recovery batch 완료 (schema decouple + readiness gating + probe diagnostics + spike guardrail)
- ✅ Goal-fidelity KPI/alert baseline (`stableHintRatio`, fallback dominance alerts)
- ✅ Goal-fidelity 안정화 2차 (stable request retry + safe command probe + stable-only fixture guard)
- ✅ v0.5 scoring v1 (category/sample/recency/node-local ranking)
- ✅ v0.5 explainability v1 (projection reason string + panel 노출)
- ✅ `G0` baseline 지표/러너/리포트 추가 (`reports/g0-baseline-report.json`)
- ✅ attempt 데이터 품질 계측 + 저품질 `tacticKey` 패턴 반영 필터(History 유지, Pattern 제외)
- ✅ suggestion TTL/상한 정책 + replay 복원 무결성 테스트 추가
- ⚠️ Goal coverage `75.0%`, stable hint ratio `75.0%`이며 Mathlib 샘플은 stable 응답이 `nullish`로 돌아와 stable hint `0` 케이스가 남음
- ✅ stable-first + fallback 구조에서 fallback-only 루프도 동작 가능함을 확인 (블로커 아님)

## Priority Queue
1. P1-C: `G1` 실측 러너/리포트(stable source on/off A/B) 추가
2. P1-D: Mathlib 샘플 stable source `nullish` 원인 분석(ready 타이밍/요청 경로/응답 파싱)
3. P2: v0.6 Performance/CI Hardening
4. Monitor: Goal-fidelity 품질(특히 Mathlib 샘플 stable hint `0` 재발 여부)

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

### 9. v0.4 Core-First Suggestion Loop (Baseline)
- [x] v0.4 실행 준비 문서 작성 (`docs/V0.4-PREP.md`)
- [x] MEL 계약 추가: `attempt_suggest` / `suggestions_clear` + `SuggestionState`
- [x] Host effect 추가: `proof_flow.attempt.suggest` (패턴/히스토리 기반 deterministic ranking)
- [x] Projection 확장: selected node 추천 tactic 목록 + 근거(score/sample/category)
- [x] Extension 트리거: command palette `proof-flow.suggestTactics` + panel action 연결
- [x] 테스트 우선 구현: domain/host/projection/e2e 각각 최소 1개 회귀 시나리오

### 10. v0.4.1 Goal Fidelity (P0)
- [x] `LeanContext.goals` 힌트 계약 추가 + range 기반 node goal 매핑 파서 반영
- [x] host 회귀 테스트 추가: goal-range 매핑/루트 fallback 검증
- [x] `dag.extract` 입력 소스 확장 1차: `loadGoals` adapter hook + diagnostics/hover/command probe 수집 경로 추가
- [x] `proof-flow.goalCoverageReport` 커맨드 추가(활성 DAG goal 채움률 즉시 측정)
- [x] command probe 2차 강화: Lean goal command 동적 탐색 + 다중 호출 시그니처 + source stats 집계
- [x] extension API probe 추가: `leanprover.lean4` export method 탐색 + source stats 집계
- [x] `dag.extract` 입력 소스 확장 2차: Lean goal source(안정 API: `$/lean/plainGoal`, `$/lean/plainTermGoal`) 직접 연동
- [x] 품질 스파이크: 실제 Lean/Mathlib 샘플에서 `goal != null` 비율 측정
- [x] 리포트: 정확도/누락 케이스/실패 패턴 문서화 (`docs/GOAL-FIDELITY-SPIKE.md`)
- [x] P0 복구 1: extension schema 로딩 경로를 `context.extensionUri` 기준으로 전환 (workspace root 결합 제거)
- [x] P0 복구 2: Lean 준비 상태 게이팅(ready/sync 안정화) 후 goal snapshot 수집
- [x] P0 복구 3: goal source probe 실패 원인/코드 로깅 및 snapshot에 원인 필드 추가
- [x] P0 복구 4: spike CI 가드레일(최소 1 fixture에서 `withGoal > 0`) 추가
- [x] P0 후속 1: stable source(`$/lean/plainGoal`) 성공률 지표화 및 fallback 의존도 경보
- [x] P0 후속 2: stable request 재시도 전략 추가(초기 transport race 완화)
- [x] P0 후속 3: command probe를 known-safe 시그니처로 축소
- [x] P0 후속 4: stable-source 전용 fixture(`StableOnly.lean`) + CI gate 추가

### 11. v0.4.2 Suggestion Closed Loop (P0)
- [x] 추천 항목 선택 UX: panel에서 tactic 선택 이벤트 추가
- [x] host/app 연결: suggest 선택 -> apply effect -> `attempt_record` 자동 반영
- [x] 실패/성공 결과를 history/patterns/suggestions에 일관 반영
- [x] 통합 E2E: suggest -> apply -> record -> resuggest 시나리오 검증

### 12. v0.4.3 Start-Here Triage (P0)
- [x] unresolved/sorry 노드 우선순위 산식 정의
- [x] projection에 `startHereQueue` 추가 및 panel 노출
- [x] 선택한 큐 항목의 editor reveal/cursor sync 일관성 검증
- [x] 긴 증명 파일 기준 유효성 시나리오 테스트 추가

### 13. v0.5 Recommendation Quality + State Hygiene (P1)
- [x] 추천 스코어링 고도화: errorCategory 일치, sample, 최근성, node-local 이력 반영
- [x] recommendation explainability: 추천 근거 문자열/메타데이터 노출
- [x] `G0` baseline 지표 정의: goal text 없이도 추천 루프가 유의미한지 측정 지표 확정
- [x] `G0` baseline 러너/리포트 추가: fallback-only 조건에서 pattern DB 효용 측정
- [x] `G1` delta 지표 정의: stable goal source 포함 시 `G0` 대비 개선폭 측정
- [x] attempt 데이터 품질 계측: tacticKey 추출 정확도/누락률 수집 + 저품질 입력 필터링 기준
- [x] suggestion TTL/상한 정책 추가(노드당 개수 제한, stale 정리)
- [x] world replay 무결성 테스트(정리 정책 적용 후 복원 일관성)
- [ ] `G1` 실측 러너/리포트 추가: stable source on/off 조건에서 `G0` 대비 lift 계산
- [ ] Mathlib sample 안정화: stable source `nullish` 재현/원인 분류/완화안 검증

### 14. v0.6 Performance / CI Hardening (P2)
- [ ] 대형 증명 파일에서 incremental sync/debounce 최적화
- [ ] 성능 회귀 측정 지표(동기화 지연, projection 렌더 시간) 추가
- [ ] CI에 통합 시나리오 최소 1개 추가(suggest loop)
- [ ] Manifesto core 연동 리스크 모니터링(`core#108`, `core#109`) 및 에스컬레이션 기준 유지
