# ProofFlow Architecture Report

## 1. 문서 목적
- 이 문서는 현재 `proof-flow`의 실제 구현 기준 아키텍처를 요약한다.
- 기준 시점은 `v0.4.x`이며, core-first 접근(도메인/런타임 우선, UI는 projection-only)을 전제로 한다.
- 코드 경로, 런타임 데이터 흐름, 검증 상태, 남은 기술 리스크를 함께 정리한다.

## 2. 시스템 개요
- 제품 형태: VS Code Extension + Manifesto Runtime 기반 Lean proof workflow assistant.
- 설계 원칙:
  - 도메인 계약은 MEL(`domain.mel`)을 단일 소스로 유지.
  - IO는 host effect layer에 한정.
  - UI(WebView)는 projection만 수행하며 도메인 정책을 갖지 않음.
  - 재현성 확보를 위해 custom WorldStore로 스냅샷/델타를 파일 기반 저장.

## 3. 모노레포 구조
| 레이어 | 경로 | 역할 |
|---|---|---|
| Domain Contract | `packages/schema/domain.mel` | 상태/액션/컴퓨티드 계약 |
| Domain Types | `packages/schema/src/index.ts` | TS 타입 정의(호스트/앱 경계 타입) |
| Host Effects | `packages/host/src/effects/*.ts` | effect handler (DAG, cursor, reveal, attempt, suggest, apply) |
| Runtime/App Config | `packages/app/src/config.ts` | Manifesto `createApp` 구성, policy/actor/validation 설정 |
| VS Code Adapter | `packages/app/src/extension.ts` | editor 이벤트-액션 브릿지, goal probe, command wiring |
| Persistence World | `packages/app/src/worldstore.ts` | 파일 기반 world snapshot/delta 저장/복원 |
| Projection/UI | `packages/app/src/projection-state.ts`, `packages/app/src/webview-panel.ts` | projection selector + WebView 렌더/상호작용 |

## 4. 런타임 계층 상세

### 4.1 Domain (MEL)
- 상태 모델:
  - `files`: 파일별 DAG 및 sync 시점
  - `ui`: 패널/선택/레이아웃/줌
  - `history`: 시도 이력
  - `patterns`: 전술 패턴 집계
  - `suggestions`: 노드별 추천 결과
- 핵심 액션:
  - 동기화: `dag_sync`, `file_activate`, `node_select`, `cursor_sync`
  - UI: `panel_toggle`, `layout_set`, `zoom_set`, `collapse_toggle`
  - 시도/추천: `attempt_record`, `attempt_apply`, `attempt_suggest`, `suggestions_clear`, `patterns_reset`
- 모든 외부 IO는 `onceIntent { effect ... }`로만 진입.

### 4.2 Manifesto Runtime/App
- `packages/app/src/config.ts`에서 `createApp` 구성:
  - `schema`: MEL 문자열 직접 주입
  - `effects`: host effect 맵 주입
  - `world`: custom store 주입
  - `policyService`: `createSilentPolicyService()`
  - `validation.effects`: `strict`
  - actor policy: `proof-flow:local-user`

### 4.3 Host Effects
- DAG 추출: `proof_flow.dag.extract`
  - `loadContext` + `loadGoals`를 조합해 `ProofDAG` 생성/검증
  - 실패 시 `dag: null`로 안전 폴백
- 에디터 연동:
  - `proof_flow.editor.reveal`
  - `proof_flow.editor.getCursor`
- 시도/패턴/추천:
  - `proof_flow.attempt.record`: history/patterns 동시 패치
  - `proof_flow.attempt.suggest`: category/score/sample 기반 결정적 랭킹
  - `proof_flow.attempt.apply`: apply 결과를 attempt 기록으로 환원

### 4.4 VS Code Extension Adapter
- 활성화 시점:
  - schema 로딩(`context.extensionUri` 우선, `proofFlow.schemaPath` override 가능)
  - world/app 부팅
  - projection subscription
- 이벤트 브릿지:
  - `onDidChangeActiveTextEditor` -> `file_activate` + `dag_sync`
  - `onDidSaveTextDocument` -> `dag_sync` + `attempt_record`(fingerprint dedupe)
  - `onDidChangeDiagnostics` -> `dag_sync` + `attempt_record`
  - `onDidChangeTextEditorSelection` -> `cursor_sync`
- command 브릿지:
  - `proof-flow.hello`
  - `proof-flow.patternsReset`
  - `proof-flow.suggestTactics`
  - `proof-flow.goalCoverageReport`
  - `proof-flow.goalCoverageSnapshot`

### 4.5 Goal Fidelity 파이프라인
- 입력 소스:
  - stable Lean 요청: `$/lean/plainGoal`, `$/lean/plainTermGoal`
  - diagnostics 기반 goal 힌트
  - hover/API/command probe
  - declaration fallback (`theorem/lemma ... : ... := by` 패턴)
- readiness 게이트:
  - Lean extension 설치/클라이언트 준비 여부
  - `dag_sync` 완료 시점
  - stable source transport 상태
- snapshot에 관측 정보 포함:
  - hint source 카운트
  - probe 실패 코드/메시지
  - readiness 상태(`ready/warming/timeout`)

### 4.6 Projection/UI
- projection selector는 읽기 모델만 구성:
  - node list + heatmap
  - attempt overview/history
  - pattern insights
  - node suggestions
  - start-here triage queue
- WebView는 상태 렌더/메시지 전송만 담당:
  - node 선택, 추천 적용, 레이아웃/줌/필터, triage 클릭

### 4.7 Persistence / Replay
- WorldStore 파일: `.proof-flow/world-store.json`
- 저장 단위: genesis snapshot + delta log
- 복원 전략:
  - delta 적용으로 world 재생성
  - dotted key(fileUri 등) 안전 복원 로직 포함
  - platform namespace(`$*`) 제거 후 sanitize

## 5. 핵심 동작 플로우

### 5.1 DAG Sync Loop
1. 에디터/진단 이벤트 발생
2. extension에서 `dag_sync(fileUri)` dispatch
3. host `dag.extract` 실행
4. `files[fileUri].dag` 갱신
5. projection selector가 read model 계산
6. WebView state update 렌더

### 5.2 Suggestion Closed Loop
1. 사용자/패널에서 `attempt_suggest`
2. 추천 리스트 표시
3. 추천 선택 시 `attempt_apply`
4. editor 삽입 결과를 attempt record로 반영
5. `dag_sync` 후 재추천(`attempt_suggest`)으로 폐루프 완성

## 6. 검증 체계
- 단위/통합 테스트: `tests/*.spec.ts`
  - domain 행동/컴플라이언스
  - host effects
  - world replay/lineage
  - extension E2E dispatch
  - projection selector
  - closed-loop 시나리오
- VS Code 스모크:
  - `pnpm test:smoke:vscode`
- Goal fidelity 스파이크:
  - `pnpm test:spike:goal-fidelity`
  - Lean 확장 및 extensionDependencies를 격리 디렉터리에 복사 후 실행
- CI:
  - `.github/workflows/ci.yml`
  - `pnpm test`, `pnpm typecheck`, `pnpm build`

## 7. 현재 관측 결과
- 최신 goal fidelity 리포트:
  - 파일: `reports/goal-fidelity-report.json`
  - 결과: `totalNodes=3`, `withGoal=2`, `66.7%`
- source 분해:
  - `declarationHints`가 현재 커버리지 회복의 주요 기여
  - stable Lean source(`plainGoal/plainTermGoal`)는 아직 기여 낮음(`stableHints=0`)

## 8. 현재 리스크와 대응 상태
- 해결됨:
  - schema workspace-root 결합 문제 제거
  - readiness 게이트/진단 수집 추가
  - spike guardrail(`withGoal > 0`) 추가
- 잔여 리스크:
  - stable Lean source 실효성 부족
  - 일부 API/command probe 시그니처 불일치
- 권장 후속:
  - stable source 성공률 KPI/경보
  - probe 시그니처 정제
  - fallback 의존도 임계치 관리

## 9. 운영 명령 요약
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test:smoke:vscode`
- `pnpm test:spike:goal-fidelity`

## 10. 결론
- 현재 아키텍처는 도메인 중심 분리(Contract/Host/Adapter/Projection/World)가 명확하게 유지되고 있다.
- 재현성과 검증 자동화(특히 spike harness)까지 갖춘 상태다.
- 제품 가치의 다음 핵심은 stable Lean goal source 품질을 fallback 중심 구조에서 실연동 중심 구조로 전환하는 것이다.
