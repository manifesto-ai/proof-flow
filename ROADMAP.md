# ProofFlow Roadmap (Manifesto-Native Hard-Cut)

## Snapshot (2026-02-19)
- 아키텍처 기준: `packages/schema + packages/host + packages/app` 인플레이스 하드컷.
- 도메인(MEL)은 `Goal/Tactic` 의미만 유지.
- Lean/LSP/DAG/진단/위치는 `$host.leanState`로 격리.
- UI는 증명 작업 흐름(Progress/Goal/Tactic/Proof Map/Lineage) 중심으로 최소화.

## KPI Gate List (Proof-Value Evidence)
- [ ] `open → resolved` 전이가 최소 1회 이상 발생해야 함 (샘플/실행 흐름 기준).
- [ ] `lineage/world head`가 `syncGoals`/`applyTactic`/`commit`/`dismiss` 인터랙션마다 증가해야 함.
- [ ] 동일 액션 시퀀스가 동일 라인리지(world IDs)와 상태 스냅샷을 생성해야 함.
- [ ] `syncGoals` 반복 시 동일 선언/위치에서 `goalId` 집합 불변성(goal-id stability)이 유지돼야 함.

## Gate Status (2.6 기준)
- [x] `open → resolved` 전이: `tests/lineage.spec.ts`, `tests/proof-loop.spec.ts`에서 검증
- [x] `lineage/world head` 증가: `tests/lineage.spec.ts`, `tests/runtime-compliance.spec.ts`에서 검증
- [x] 동일 시퀀스 재현성: `tests/lineage.spec.ts`, `tests/proof-loop.spec.ts`, `scripts/vscode-goal-fidelity-suite.cjs`
- [x] `goalId` 안정성: `tests/host-effects.spec.ts`, `scripts/vscode-goal-fidelity-suite.cjs`

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
  - 도메인 계약 대비 `lean.syncGoals`, `lean.applyTactic` effect 유효성 고정
- [x] lineage diff 리포트 포맷을 goal 상태 전이 중심으로 교체
- [x] 테스트 스위트 하드컷 기준 재작성
- [x] P0 항목: 실패 UX 정교화, goalId 안정성, tactic 실패 결과 저장 및 실패사유 전파
- [x] P1 항목: UI 반응성/스크롤, Proof Map-에디터 동기화 정렬
- [x] P2 항목: 단일 파일 제약/영속 정책 문서 고정
- [x] `manifesto-value-evidence` 증거 문서 갱신 (`docs/manifesto-value-evidence-2026-02-21.md`)

### Quality Gates
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `pnpm test:spike:goal-fidelity`
- [x] `pnpm test:smoke:vscode`

## P2 Checklist
- [x] 멀티파일 확장 가드와 영속 옵션 가이드라인이 문서로 반영되어 정합 점검됨

## Status Checklist for Phase 5
- [x] 핵심 KPI 계약은 문서화 완료
- [x] goal 상태 전이/lineage 재현성 자동검증을 위한 실제 샘플 3종 기준치 통과 확인
- [x] `pnpm test:spike:goal-fidelity` + `pnpm test:smoke:vscode` 정기 수행 체계화

## Risks
1. Lean diagnostics 타이밍 지연으로 `syncGoals` 반응성이 흔들릴 수 있음.
2. Mathlib 파일에서 goal 추출 안정성이 떨어지면 Proof Map 신뢰도 저하.
3. intent marker(`applying/resolving/syncing`)는 실행 추적에는 유효하지만 비교 테스트에서는 노이즈가 될 수 있음.

## Immediate Queue
1. KPI 게이트 4종의 연속 실행 리포트 체인 정렬 (`manifesto-value-evidence` 주기 갱신)
2. 사용자 피드백을 반영한 실패 케이스(전략 시도 실패, 부분 해소)에 대한 샘플 라이브러리 확장
3. 레거시 문서 하드컷 완료: 하드컷 범위를 벗어난 문서는 삭제 후 활성 계약 문서만 유지
