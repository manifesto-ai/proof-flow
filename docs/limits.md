# ProofFlow 운영 제약 및 적용 범위

이 문서는 ProofFlow v2 하드컷 버전의 현재 운영 가정과 확장 전 제약을 정리한다.

## 1) 처리 범위: 단일 파일(`.lean`) 우선

현재 ProofFlow는 **단일 Lean 파일 단위의 실시간 증명 루프**를 기준으로 동작한다.

- 대상: 현재 활성 에디터 문서(`isLeanDocument`) 1개 기준
- 정합성 체크 범위: 활성 문서 내 goal/node 상태
- 목표: Lean 문법 기반 증명 목표의 `Goal` 상태(`open`, `resolved`, `failed`)가 즉시 반영되는 루프 보장

### 제외 범위 (v2 하드컷)

다음 항목은 기능이 완성되지 않은 상태이므로 본 단계에서 제외한다.

- 멀티 파일/크로스 파일 DAG 정합성
- 파일 간 goal 의존성 전파 모델
- 증명 중간 상태의 교차 파일 재시작 정책

제외 이유:

- 현재 Host 파싱/추출 파이프라인은 활성 문서 기준 상태 정렬과 ID 안정성을 전제로 설계됨
- `syncGoals`의 안정성은 `fileUri` 단위의 반복 동기화로 검증됨

## 2) World persistence 정책

현재 기본값은 **메모리 기반 World 상태 유지**이다.

- `createProofFlowApp` 호출에서 `world` 주입을 기본으로 수행하지 않는다.
- 기본 경로, 체크포인트 포맷, 병합 정책은 운영하지 않는다.

### 영속화는 실험 옵션

- 영속 World는 기본 동작이 아니다.
- 필요시 별도 실험 설정에서만 도입해야 하며(선택 토글), 본 버전은 기본 동작을 변경하지 않는다.
- 영속화를 넣을 경우 WorldStore 스킴과 lineage 재현성(`goal` 상태/액션 순서)이 기존 메모리 정책과 동일해야 한다.

## 3) 현재 활성 계약으로의 정합성 가드

Active 계약과 충돌하는 레거시 조각은 문서/커맨드/효과에서 제거 상태여야 한다.

- 계약: `syncGoals / applyTactic / commitTactic / dismissTactic / selectGoal`
- effect: `lean.syncGoals`, `lean.applyTactic`
- 패널: `stateUpdate` + 아웃바운드 액션 5개
- 커맨드: `proof-flow.hello`, `proof-flow.lineageDiffReport`

해당 조합이 바뀌면 계약 변경으로 간주하고 P1 이전 계획은 재확정해야 한다.
