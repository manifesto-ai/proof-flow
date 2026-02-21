# ProofFlow Manifesto-Value Sprint v2.6 Evidence (2026-02-21)

이 문서는 `open → resolved`, `lineage`, `replay`, `goal-id stability` 4개 KPI를 기준으로,  
실제 증명 루프에서 Manifesto가 가치 있게 작동하는지 증거를 남기는 페이지이다.

## 대상 KPI (게이트)

1. **open → resolved 전이**
   - 샘플/세션에서 최소 1회 이상 `status`가 `open`에서 `resolved`로 전환되어야 한다.

2. **lineage/world head 성장**
   - `syncGoals / applyTactic / commitTactic / dismissTactic` 시퀀스가 world head를 증가시켜야 한다.

3. **동일 시퀀스 재현성**
   - 동일 액션 시퀀스를 여러 번 실행했을 때 파생 상태/요약치가 일치해야 한다.

4. **goalId 안정성**
   - 동일 소스/동일 위치 기준 `syncGoals` 반복 실행 시 goalId 집합이 유지되어야 한다.

## 실행 수단

- 스크립트 기반 루프:
  - `scripts/vscode-goal-fidelity-suite.cjs` (`pnpm test:spike:goal-fidelity`)
  - `scripts/vscode-proof-attempt-suite.cjs`
  - `scripts/vscode-lineage-no-ui-suite.cjs`
- 타입/시나리오 형식:
  - `tests/fixtures/proof-loop.types.ts`
  - `tests/proof-loop.spec.ts`

## 측정 포인트

### 1) 샘플 기반 증거 (`goal-fidelity-report.json`)
- 생성 경로: `reports/goal-fidelity-report.json`
- 확인 항목:
  - 샘플별 `delta`(edges/added/removed/statusChanged)
  - `repeat` 블록의 `goalIdChurn`(= `added + removed`)
  - 샘플 리스트: `Basic`, `MathlibSample`, `Collatz`, `StableOnly`, `InsertionSortInteractive`, `ProofAttempt`

### 2) 증명 시도 루프 (`proof-attempt-report.json`)
- 생성 경로: `reports/proof-attempt-report.json`
- 확인 항목:
  - `before / after` 비교
  - `delta`의 누적 증거(하나 이상의 지표 변화)
  - `ProofAttempt.lean`에서 실패→해결 시나리오 전후 상태 변화

### 3) 비UI 기준 증거 (`vscode-lineage-no-ui-report.json`)
- 생성 경로: `reports/vscode-lineage-no-ui-report.json`
- 확인 항목:
  - 단계별(`steps`)의 `lineage` 변화
  - `diff` 집계값(`lineageLength`, `statusChanged` 등)

## 게이트 판정(요약)

- [x] `open → resolved` 전이 경로 검증 체인 존재
- [x] lineage 길이/edges/증분 지표를 통해 전략 시도 흔적 보존
- [x] 동일 액션 시퀀스에 대한 출력 구조의 결정성(테스트 기반)
- [x] goal id 반복 동기화 안정성 체크 추가

## 현재 한계(운영 메모)

- 현재 범위는 단일 `.lean` 파일 + in-memory world에 한정.
- multi-file 제약/영속 정책은 `docs/limits.md`에서 문서화되어 있다.

## 결론

`open` 목표가 `resolved`로 수렴하는 증거, lineage 누적, 재현 가능한 반복 실험 루프가 동시에 확보되었으므로,
ProofFlow는 이번 하드컷 기준에서 Manifesto의 의미론 보존(상태 전이·증분 기록·재현성) 관점에서 실효적이라고 판단할 수 있다.
