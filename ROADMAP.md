# ProofFlow Roadmap (Manifesto-Native Hard-Cut)

## Snapshot (2026-02-19)
- 아키텍처 기준: `packages/schema + packages/host + packages/app` 인플레이스 하드컷.
- 도메인(MEL)은 `Goal/Tactic` 의미만 유지.
- Lean/LSP/DAG/진단/위치는 `$host.leanState`로 격리.
- UI는 증명 작업 흐름(Progress/Goal/Tactic/Proof Map) 중심으로 최소화.

## KPI (Proof-Value Loop)
- `Goal status transition`: `statusChanged / edges` (lineage report에서 최소 1회 이상 증가) — 목표
- `Action/world integrity`: `lineageLength > 0` and world head monotonically increases on each intent
- `Replay determinism`: 동일 `action` 시퀀스가 동일 `worldIds`를 생성해야 함
- `Goal id stability`: 동일 소스/목표 위치에서 `syncGoals` 반복 시 `goalId` 집합 불변

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
- [x] `ProofLoop` 시뮬레이션을 위한 타입 헬퍼 추가 (`tests/fixtures/proof-loop.types.ts`)
- [x] 스크립트 stale 커맨드 정리 (`goalCoverageSnapshot`/`suggestTactics`/`performanceSnapshot` 참조 제거)
- [x] proof attempt/lineage goal-fidelity 샘플에 대한 경량 스크립트 시나리오 업데이트
- [x] `domain.mel` 하드컷 (Goal/Tactic 중심)
- [x] schema 타입 재정의 (`Goal`, `TacticResult`, `ProofFlowState`)
- [x] host effect registry 하드컷 (`lean.*` 2개만 유지)
- [x] legacy `proof_flow.*` effect 구현 삭제
- [x] Lean 파생 로직 재정리 (`derive.ts`, stable goal id/host dag 구성)
- [x] extension 이벤트 파이프라인 단순화 (`syncGoals` 중심)
- [x] panel/webview 계약 단순화 및 최소 UX로 축소
- [x] `@manifesto-ai/app` → `@manifesto-ai/sdk` 마이그레이션 완료
  - 앱 생성/타입 경로 정합
  - `act` 완료 대기 API를 `completed()` 우선으로 정렬
  - 도메인 규격 대비 `lean.syncGoals`, `lean.applyTactic` effect 유효성 고정
- [x] lineage diff 리포트 포맷을 goal 상태 전이 중심으로 교체
- [x] 테스트 스위트 하드컷 기준 재작성
- [x] 품질 게이트 통과
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm build`
  - `pnpm test:smoke:vscode`

## Remaining Work
### P0 (증명 사용성 필수)
- [x] 실제 Lean 증명 파일 3종(기본/induction/Mathlib) 회귀 픽스처 고정
- [x] tactic 실패 UX 정교화 (실패 이유 + dismiss 액션 안내 카드 통합)
- [x] goal id 안정성 회귀 테스트 강화 (whitespace/반복 sync에서 ID 불변성 검증)
- [x] `lineageDiffReport`를 증명 세션 리포트 템플릿으로 정리

### P1 (UI/UX 정돈)
- [x] 패널 스크롤/레이아웃 안정화 (overflow-y:auto + 고정 핵심 카드)
- [x] Proof Map 노드/goal 선택 → 에디터 reveal 동기화 경로 점검 (E2E 포함)
- [x] 기본 화면 정보 밀도 축소 완료 (필수 5요소 중심)

### P2 (운영/확장)
- [x] 리포트 export 경로 표준화 (`reports/` 고정, 환경변수 오버라이드 지원)
- [x] 단일 파일 범위 밖(멀티파일) 확장 전 선행 제약 문서화 (`docs/limits.md`)
- [x] World store 영속화는 옵션으로만 실험 (기본 메모리 유지) 정리 (`docs/limits.md`)

### P2 Checklist
- [ ] 멀티파일 확장 가드와 영속 옵션 가이드라인이 문서로만 남아 있는지 정기 점검

## Status Checklist for Phase 5
- [x] 핵심 KPI 계약은 문서화 완료
- [x] goal 상태 전이/lineage 재현성 자동검증을 위한 실제 샘플 3건 기준치 통과 확인
- [x] `pnpm test:spike:goal-fidelity` + `pnpm test:smoke:vscode` 정기 수행 체계화

## Risks
1. Lean diagnostics 타이밍 지연으로 `syncGoals` 반응성이 흔들릴 수 있음.
2. Mathlib 파일에서 goal 추출 안정성이 떨어지면 Proof Map 신뢰도 저하.
3. intent marker(`applying/resolving/syncing`)는 실행 추적에는 유효하지만 비교 테스트에서는 노이즈가 될 수 있음.

## Immediate Queue
1. P2 과제 정리: 멀티파일 제약/영속 World 옵션 정책의 구현 전 문서 고정 상태 확인.
2. `@proof-flow` 스크립트/문서에서 삭제된 액션/효과 레거시 조각 정기 점검.
3. `proof_flow` 핵심 이슈 반영 결과(핵심값 증거) 공유.
