# ProofFlow Roadmap (Manifesto-Native Hard-Cut)

## Snapshot (2026-02-09)
- 아키텍처 기준: `packages/schema + packages/host + packages/app` 인플레이스 하드컷.
- 도메인(MEL)은 `Goal/Tactic` 의미만 유지.
- Lean/LSP/DAG/진단/위치는 `$host.leanState`로 격리.
- UI는 증명 작업 흐름(Progress/Goal/Tactic/Proof Map) 중심으로 최소화.

## Active Contracts (v2)
### MEL actions
- `syncGoals`
- `applyTactic(goalId, tactic)`
- `commitTactic`
- `dismissTactic`
- `selectGoal(goalId | null)`

### MEL state
- `goals`
- `activeGoalId`
- `lastTactic`
- `tacticResult`
- `applyingTactic`
- `resolvingGoal`
- `syncingGoals`

### Host effects
- `lean.syncGoals({ into })`
- `lean.applyTactic({ goalId, tactic, into })`

### Panel message contract
- panel -> extension: `selectGoal`, `applyTactic`, `commitTactic`, `dismissTactic`, `togglePanel`
- extension -> panel: `stateUpdate`

### VS Code commands
- 유지: `proof-flow.hello`, `proof-flow.lineageDiffReport`
- 제거 완료: `dag_sync/sorry_queue_refresh/breakage_analyze/diagnose` 및 연계 커맨드/분기

## Completed
- [x] `domain.mel` 하드컷 (Goal/Tactic 중심)
- [x] schema 타입 재정의 (`Goal`, `TacticResult`, `ProofFlowState`)
- [x] host effect registry 하드컷 (`lean.*` 2개만 유지)
- [x] legacy `proof_flow.*` effect 구현 삭제
- [x] Lean 파생 로직 재정리 (`derive.ts`, stable goal id/host dag 구성)
- [x] extension 이벤트 파이프라인 단순화 (`syncGoals` 중심)
- [x] panel/webview 계약 단순화 및 최소 UX로 축소
- [x] lineage diff 리포트 포맷을 goal 상태 전이 중심으로 교체
- [x] 테스트 스위트 하드컷 기준 재작성
- [x] 품질 게이트 통과
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm build`
  - `pnpm test:smoke:vscode`

## Remaining Work
### P0 (증명 사용성 필수)
- [ ] 실제 Lean 증명 파일 3종(기본/induction/Mathlib) 회귀 픽스처 고정
- [ ] tactic 실패 UX 정교화 (실패 이유 + 다음 액션 안내를 카드 1개로 통합)
- [ ] goal id 안정성 회귀 테스트 강화 (편집/저장 반복 시 동일 goal 매핑 보장)
- [ ] `lineageDiffReport`를 증명 세션 리포트 템플릿으로 정리

### P1 (UI/UX 정돈)
- [ ] 패널 스크롤/레이아웃 안정화 (긴 증명에서 항상 조작 가능)
- [ ] Proof Map 노드 선택/에디터 reveal 동기화 회귀 E2E 추가
- [ ] 기본 화면 정보 밀도 추가 축소 (증명에 직접 필요한 정보만 유지)

### P2 (운영/확장)
- [ ] 리포트 export 경로/포맷 표준화 (CI artifact로도 수집 가능하게)
- [ ] 단일 파일 범위 밖(멀티파일) 확장 전 선행 제약 문서화
- [ ] World store 영속화는 옵션으로만 실험 (기본 메모리 유지)

## Risks
1. Lean diagnostics 타이밍 지연으로 `syncGoals` 반응성이 흔들릴 수 있음.
2. Mathlib 파일에서 goal 추출 안정성이 떨어지면 Proof Map 신뢰도 저하.
3. intent marker(`applying/resolving/syncing`)는 실행 추적에는 유효하지만 비교 테스트에서는 노이즈가 될 수 있음.

## Immediate Queue
1. Lean 샘플 3종 회귀 픽스처 확정.
2. tactic 실패 UX 카드 통합.
3. Proof Map 선택-에디터 동기화 E2E 추가.
