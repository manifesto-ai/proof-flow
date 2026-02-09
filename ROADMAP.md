# ProofFlow Roadmap (v2 Hard-Cut)

## Snapshot (2026-02-09)
- 현재 기준은 `v2 hard-cut`이며, v0.x attempt/pattern/suggestion/history 계층은 제거됨.
- 제품 초점은 `증명의 GPS`: 현재 위치(Proof Map) + 다음 작업(Goal Diff/Diagnosis/Sorry Queue) 제공.
- Manifesto 연동은 `projection-only` 원칙 유지(도메인 정책은 MEL/Host에서만 처리).

## Current Scope
### In Scope
- Flattened MEL state/action contract
  - state: `files`, `activeFileUri`, `selectedNodeId`, `cursorNodeId`, `panelVisible`, `sorryQueue`, `breakageMap`, `activeDiagnosis`
  - action: `file_activate`, `node_select`, `cursor_sync`, `panel_set`, `dag_sync`, `sorry_queue_refresh`, `breakage_analyze`, `diagnose`, `diagnosis_dismiss`
- Host effects (core IO only)
  - `proof_flow.dag.extract`
  - `proof_flow.editor.reveal`
  - `proof_flow.editor.getCursor`
  - `proof_flow.diagnose`
  - `proof_flow.sorry.analyze`
  - `proof_flow.breakage.analyze`
- Webview UI
  - ReactFlow 기반 Proof Map
  - Progress/Goal Diff/Diagnosis/Sorry Queue 중심 구성
  - Extension 메시지 계약 최소화(`nodeClick`, `togglePanel` -> `stateUpdate`)

### Out of Scope (Removed)
- `attempt_record`, `attempt_apply`, `attempt_suggest`
- `history`, `patterns`, `suggestions` 상태/리셋 커맨드
- attempt 기반 통계 루프(`g0/g1/suggestion-loop`, replay metrics 중심 실험)
- WorldStore 전용 커스텀 계층

## Completed (v2.0)
- [x] MEL 도메인 하드컷(중첩 `ui` 제거, 루트 state 평탄화)
- [x] Schema 타입 하드컷(v1/v0.x 타입 제거)
- [x] Host effect registry 정리(attempt 계열 제거)
- [x] DAG schema/parser 정리(`metrics`, legacy `goal` 제거; `goalCurrent + goalSnapshots + progress` 고정)
- [x] Extension/Panel 계약 단순화
- [x] Webview 구성 정리(핵심 패널 중심)
- [x] 테스트 스위트 v2 기준 재작성
- [x] 품질 게이트 통과
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
  - `pnpm test:smoke:vscode`
- [x] 리포트/로컬 산출물 ignore 정책 정리(`.gitignore` + reports untrack)

## Next Milestones
### v2.1 Proof Workflow Validation (P0)
- [ ] 실제 Lean/Mathlib 증명 시나리오 3종 확정 및 회귀 테스트화
  - 단순 정리
  - 중간 난이도(induction/cases)
  - Mathlib import 의존 정리
- [ ] `dag_sync -> panel stateUpdate` 반응성 계측(저장/진단 이벤트 기준)
- [ ] Goal fidelity 리그레션 가드 추가
  - `goalCurrent` null 비율
  - Mathlib 샘플에서 stable source/ fallback 점유율 추적
- [ ] `panel_set`/selection 동기화 E2E 강화(패널 open/close 및 reveal 동작)

### v2.2 UX Refinement (P1)
- [ ] 패널 정보 밀도 축소
  - 기본 화면: Progress + Proof Map
  - 조건부: Goal Diff(선택 시), Diagnosis(에러 선택 시), Sorry Queue(sorry 존재 시)
- [ ] 스크롤/레이아웃 안정화(긴 증명 파일에서 panel 사용성 보장)
- [ ] Analyze/Debug 노출 전략 분리(기본 숨김 + 개발 모드 토글)

### v2.3 Proof Intelligence (P1)
- [ ] GoalSnapshot 품질 향상
  - tactic 전후 diff 신뢰도 개선
  - applied lemma 수집 정확도 개선
- [ ] Diagnosis 규칙 개선
  - `TYPE_MISMATCH`, `UNSOLVED_GOALS` 메시지 구조화 품질 향상
- [ ] BreakageMap 신뢰도 개선
  - dependency edge 기준 false-positive 감소

### v2.4 Ops / Governance (P2)
- [ ] CI 게이트 재정렬
  - 코어 파이프라인 중심 스위트 고정
  - 제거된 v0.x 시나리오 관련 스크립트/문서 정리
- [ ] Manifesto core 연동 리스크 모니터링 지속
  - `core#108`, `core#109` 추적
  - 에스컬레이션 기준 문서화

## Active Risks
1. Mathlib 환경에서 stable goal source 가용성 변동.
2. Lean diagnostics 타이밍에 따른 panel 반응 지연/누락 가능성.
3. GoalSnapshot 데이터 품질이 낮으면 UX 가치가 급감할 수 있음.

## Immediate Queue (다음 작업 순서)
1. v2.1 시나리오 3종 회귀 테스트 추가.
2. 패널 조건부 렌더 규칙을 강제하는 UI 테스트 추가.
3. Goal fidelity 지표를 리포트 JSON 대신 테스트 assertion으로 내재화.
