# ProofFlow 운영 제약 및 적용 범위 (v2.6 hard-cut)

이 문서는 ProofFlow v2.6 하드컷 기준의 운영 가정과 확장 전 제약을 정리한다.

## 1) 처리 범위: 단일 파일(`.lean`) 우선

현재 ProofFlow는 **단일 Lean 파일 단위의 실시간 증명 루프**를 기준으로 동작한다.

- 대상: 현재 활성 에디터 문서(`isLeanDocument`) 1개 기준
- 정합성 체크 범위: 활성 문서 내 goal/node 상태
- 목표: Lean 문법 기반 증명 목표의 `Goal` 상태(`open`, `resolved`, `failed`)가 즉시 반영되는 루프 보장

### 제외 범위 (v2 하드컷)

다음 항목은 본 단계에서 제외한다.

- 멀티 파일/크로스 파일 DAG 정합성
- 파일 간 goal 의존성 전파 모델
- 증명 중간 상태의 교차 파일 재시작 정책
- 다중 월드 스토어 동시성/병합 정책

### 제외 이유

- 현재 Host 파싱/추출 파이프라인은 활성 문서 단위 상태 정렬과 goalId 안정성을 전제로 설계됨
- `syncGoals` 안정성은 `fileUri` 반복 동기화 기준으로 검증됨

## 2) World persistence 정책

현재 기본값은 **in-memory** 다.

- `createProofFlowApp` 기본 생성에서 `world` 주입은 수행하지 않는다.
- 영속 checkpoint/병합/리플레이 정책은 기본 동작으로 제공하지 않는다.
- 영속 World는 실험 옵션으로만 허용되며, 실험 시에도 메모리 기본 동작과 동일한 재현성/액션 순서를 유지해야 한다.

## 3) 현재 계약 정합성 가드

활성 계약은 다음 조합을 기준으로 유지한다.

- 액션: `syncGoals / applyTactic / commitTactic / dismissTactic / selectGoal`
- effect: `lean.syncGoals`, `lean.applyTactic`
- 패널: `stateUpdate` + 아웃바운드 5개(`selectGoal`, `applyTactic`, `commitTactic`, `dismissTactic`, `togglePanel`)
- 커맨드: `proof-flow.hello`, `proof-flow.lineageDiffReport`

이 조합이 바뀌면 계약 재협의로 간주한다.
