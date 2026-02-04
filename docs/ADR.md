# ProofFlow Architectural Decision Records

> **Project:** ProofFlow — Lean 4 Proof Exploration & Visualization  
> **Status:** Accepted  
> **Date:** 2026-02-04  
> **Deciders:** 정성우 (Sungwoo Jung)  
> **Scope:** ProofFlow 전체 아키텍처 (v0.1–v0.3)

---

## ADR-001: Manifesto-Native Architecture

### Context

ProofFlow는 VS Code 확장으로 구현되지만, 단순한 에디터 플러그인이 아니라 **Manifesto 프레임워크의 쇼케이스**로 기획된다.

초기 PRD에서는 `.proof-flow/history.json`, `.proof-flow/patterns.json` 등 독자적 저장 메커니즘과 `StorageState`, `BuffersState` 같은 I/O 관련 도메인 상태를 정의했다. 이는 Manifesto가 이미 제공하는 기능을 재발명하는 것이었다.

| 초기 설계의 재발명 | Manifesto가 이미 제공 |
|---|---|
| `StorageState` (dirty flag, save path) | WorldStore (Delta + Checkpoint + Lazy Loading) |
| `BuffersState` (loadedHistory, writeResult) | Host effect → Patch 반환 |
| `.proof-flow/history.json` 수동 관리 | World Lineage (immutable, append-only DAG) |
| DAG 시계열 기록 별도 설계 | World snapshot per Proposal (lineage 역추적으로 모든 시점 복원) |
| flush action + dirty flag | WorldStore persistence (D-STORE-1) |
| 재진입 패턴 자체 설계 | Host event-loop의 run-to-completion + re-entry |

### Decision

**ProofFlow는 Manifesto App SPEC v2.0.0 Minimal Compliance를 목표로 한다.**

구체적으로:

1. **WorldStore가 모든 영속성을 담당한다.** `.proof-flow/*.json` 별도 저장 없음. history, patterns, DAG 스냅샷 모두 World snapshot 내 도메인 데이터로 관리되며, WorldStore의 Delta + Checkpoint 전략으로 저장됨.

2. **도메인 스키마에서 I/O 관련 상태를 제거한다.** `StorageState`, `BuffersState`, `WriteResult`는 도메인이 알아야 할 개념이 아님. 이들은 Host/WorldStore의 책임.

3. **모든 상태 변경은 Proposal → Authority → Host 실행 → World 생성 흐름을 따른다.** MEL의 `action`은 Intent로 매핑되고, 매 실행의 결과는 immutable World로 봉인됨.

4. **Replay가 보장된다.** World SPEC REPLAY-1~3에 의해, 동일한 Proposal sequence를 재생하면 동일한 WorldId가 나옴. 증명 과정의 완전한 재현이 가능.

### Consequences

**Positive:**
- 저장/복원/재진입/히스토리를 직접 구현하지 않아도 됨 (개발 비용 대폭 감소)
- "증명의 시간적 진화"가 World lineage로 자동 기록됨
- Manifesto 생태계의 검증된 인프라(Checkpoint, Compaction, Restore Context 등)를 그대로 활용
- Manifesto 쇼케이스로서 프레임워크의 실용성을 입증

**Negative:**
- Manifesto 런타임에 대한 의존 (standalone으로 동작 불가)
- VS Code extension lifecycle과 Manifesto App lifecycle의 매핑이 필요
- Manifesto 자체가 아직 성숙 초기이므로, 프레임워크 버그가 제품 버그가 될 수 있음

### Compliance

| Manifesto SPEC | ProofFlow 적용 |
|---|---|
| App Lifecycle (§7) | VS Code extension activate/deactivate에 매핑 |
| HostExecutor (§8) | App이 Lean LSP + VS Code API를 wrapping하여 구현 |
| WorldStore (§9) | Delta + Checkpoint, 로컬 파일시스템 기반 |
| Branch (§12) | v0.1에서는 단일 branch (main) |
| Schema Registry (§13) | 버전별 도메인 스키마 등록 |

---

## ADR-002: Host Boundary — "선물상자 원칙"

### Context

ProofFlow의 핵심 데이터 흐름은 다음과 같다:

```
Lean 4 editor → LSP diagnostics → DAG 추출 → 도메인 상태 업데이트
```

이 파이프라인에서 **어디까지가 Host이고 어디서부터가 Core인가**를 명확히 해야 한다. Manifesto ADR-001의 원칙은 "Core는 IO를 모른다"이지만, ProofFlow에서는 외부 데이터(Lean LSP)의 파싱/정제가 상당히 복잡하므로 경계를 정밀하게 정의할 필요가 있다.

### Decision

**"선물상자 원칙": Core는 선물상자를 까기 전의 상태. Host가 상자를 열고, 정제하고, Zod로 검증된 타입으로 포장하여 Core에 전달한다.**

구체적인 경계:

```
┌─────────────────────────────────────────────────────────┐
│                       Host 영역                          │
│                                                         │
│  1. Lean LSP 호출 (diagnostics, goalState, infoTree)    │
│  2. Raw diagnostics 파싱                                │
│  3. DAG 구조 추출 (노드/엣지 식별)                       │
│  4. NodeKind, NodeStatus 분류                           │
│  5. ErrorCategory 패턴매칭                               │
│  6. tacticKey 추출                                      │
│  7. Zod schema validation                               │
│  8. → 정제된 ProofDAG / AttemptRecord 타입 반환          │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                       경계                               │
│  Host effect 결과 = Zod-validated domain type           │
│  Core가 받는 것 = 이미 신뢰 가능한 타입                   │
├─────────────────────────────────────────────────────────┤
│                       Core 영역                          │
│                                                         │
│  1. 정제된 ProofDAG로 state patch 생성                   │
│  2. AttemptRecord로 history/patterns 업데이트            │
│  3. Computed 계산 (metrics, activeFile 등)               │
│  4. Guard 평가 (when 조건)                               │
│                                                         │
│  Core는 모른다:                                          │
│  - LSP가 무엇인지                                        │
│  - diagnostics의 원본 포맷                               │
│  - Zod validation이 어떻게 수행되었는지                   │
│  - 파일시스템 경로                                        │
│  - VS Code API                                          │
└─────────────────────────────────────────────────────────┘
```

### Host Effect 계약

```typescript
// Host가 제공하는 effect 타입 (도메인이 선언, Host가 이행)
type ProofFlowEffects = {
  // DAG 추출: Host가 LSP 호출 + 파싱 + Zod 검증까지 수행
  'proof_flow.dag.extract': {
    input: { fileUri: string };
    output: ProofDAG;  // Zod-validated, Core가 신뢰
  };

  // Attempt 감지: Host가 tactic 변경 diff + 결과 판정까지 수행
  'proof_flow.attempt.detect': {
    input: { fileUri: string; nodeId: string };
    output: AttemptRecord;  // Zod-validated
  };

  // Editor 네비게이션: Host가 VS Code API 호출
  'proof_flow.editor.reveal': {
    input: { fileUri: string; range: Range };
    output: void;
  };
};
```

### Rationale

이 경계가 **"파싱도 Core에서"**보다 나은 이유:

1. **테스트 격리**: Core 테스트에서 LSP mock이 불필요. 정제된 `ProofDAG` fixture만으로 전체 도메인 로직 검증 가능.
2. **교체 가능성**: Lean LSP가 아닌 다른 소스(예: Lean 파일 직접 파싱, 원격 서버)에서 DAG를 얻어도 Core 변경 없음.
3. **에러 격리**: LSP 파싱 에러, 타임아웃, 비정상 응답 처리가 전부 Host 책임. Core는 항상 유효한 타입만 봄.
4. **Manifesto 정합**: Core SPEC "Does NOT know: IO, execution" 원칙 준수. Host SPEC "Converge execution to terminal state" — LSP 호출과 파싱은 실행(execution)의 일부.

### Consequences

**Positive:**
- Core의 순수성 보장 — 테스트, 디버깅, 재현이 쉬움
- Host를 교체하면 다른 정리 증명 시스템(Coq, Agda 등)에도 같은 Core를 쓸 수 있는 확장 가능성
- Zod validation이 Host 경계에서 보장되므로, Core 내부에서 런타임 타입 체크 불필요

**Negative:**
- Host의 구현 복잡도 증가 (DAG extractor가 Host에 포함)
- Host effect의 반환 타입이 풍부해야 하므로, effect 계약 정의에 주의 필요

---

## ADR-003: Single-Actor Auto-Approve Governance

### Context

Manifesto World Protocol은 Actor(제안자), Authority(승인자), Proposal(제안) 개념으로 거버넌스를 구성한다. ProofFlow v0.1–v0.3에서 이 모델을 어떻게 적용할 것인가.

가능한 옵션:
- **A) 풀 거버넌스**: 다수 Actor, Authority 정책, Scope 제한 → 개인 도구에 과잉
- **B) Single-Actor, Auto-Approve**: 사용자 1명, 항상 승인 → 최소 오버헤드
- **C) 거버넌스 생략**: World Protocol을 쓰되 Proposal/Authority 건너뜀 → 스펙 위반

### Decision

**Option B: Single-Actor, Auto-Approve.**

```typescript
// ProofFlow의 거버넌스 설정
const PROOFFLOW_GOVERNANCE = {
  actor: {
    id: 'proof-flow:local-user',
    kind: 'human',
  },
  authority: {
    id: 'proof-flow:auto-approve',
    evaluate: async (_proposal) => ({ kind: 'approved' as const }),
  },
  executionKeyPolicy: (proposal) => `proposal:${proposal.proposalId}`,
  // Maximum parallelism — 각 Proposal이 독립 실행
} as const;
```

| 요소 | 결정 |
|---|---|
| Actor | 단일. `proof-flow:local-user` |
| Authority | 항상 승인. 거부/평가 로직 없음 |
| ExecutionKey | Proposal당 고유 (default policy, 최대 병렬성) |
| ApprovedScope | 전체 허용 (제한 없음) |
| Multi-actor 확장 | 별도 ADR로 미룸 (Git 공유 Phase 2) |

### Rationale

1. **World Protocol 준수**: Proposal → DecisionRecord → World 흐름을 유지. 생략이 아닌 최소 구현.
2. **확장 경로 보존**: Authority를 인터페이스로 주입하므로, 나중에 multi-actor 정책으로 교체 가능.
3. **오버헤드 최소화**: auto-approve는 사실상 동기 함수 호출 하나. 사용자 체감 지연 없음.

### Consequences

**Positive:**
- Manifesto World Protocol의 full lifecycle을 쇼케이스하면서도 실용적
- Authority 교체만으로 거버넌스 확장 가능 (코드 구조 변경 없음)

**Negative:**
- Git 공유 시나리오에서 "누구의 시도인가"를 구분하려면 Actor 분리가 필요 → 별도 ADR

---

## ADR-004: Git-First Sharing Strategy

### Context

ProofFlow의 데이터(증명 시도 이력, 패턴 통계)를 팀/커뮤니티와 공유할 방법이 필요하다. 선택지는:
- **A) SaaS/서버**: 중앙 집중 저장 → 개발/운영 비용, 프라이버시 우려
- **B) Git 기반**: 코드와 데이터가 같은 생명주기 → 동기화 문제 원천 차단
- **C) P2P**: 분산 동기화 → 구현 복잡도 과잉

### Decision

**Option B: Git-First.**

WorldStore의 물리적 저장 위치를 **워크스페이스 내 `.proof-flow/` 디렉토리**로 하되, **사용자별 파일 분리**를 적용한다.

```
.proof-flow/
├── worlds/
│   ├── {username}/          # 사용자별 World 데이터
│   │   ├── checkpoints/     # WorldStore checkpoint files
│   │   ├── deltas/          # WorldStore delta files  
│   │   └── index.json       # WorldIndex
│   └── _merged/             # 읽기 전용 집계 뷰 (ProofFlow가 생성)
└── config.json              # 공유 설정
```

### 진화 경로

```
Phase 1 (MVP, 개인)
  .proof-flow/worlds/{user}/   ← WorldStore 단일 사용자
  Git에 커밋하지 않아도 됨

Phase 2 (Git 공유)
  같은 구조, git commit으로 팀 공유
  ProofFlow가 다른 사용자 디렉토리를 읽어 merged view 제공
  Merge conflict 구조적으로 없음 (각자 파일 분리)

Phase 3 (SaaS)
  같은 스키마를 API로 push/pull
  클라우드가 전체 집계 + fingerprint 클러스터링
  로컬은 독립 동작 유지 (오프라인 퍼스트)
```

### Rationale

1. **코드-데이터 동기화**: 증명 코드가 리팩토링되면 데이터도 같은 커밋에서 갱신. SaaS에서 발생하는 "코드는 바뀌었는데 클라우드 데이터는 옛날 구조" 문제가 원천적으로 없음.
2. **Merge conflict 회피**: 사용자별 디렉토리 분리로 같은 파일을 동시 수정하는 일이 구조적으로 없음.
3. **프라이버시 제어**: `.gitignore`로 개인 데이터 제외 가능. 공유 범위를 사용자가 결정.
4. **Phase 간 마이그레이션 최소화**: 스키마가 동일하므로 전송 계층만 추가하면 SaaS 전환 가능.

### Username 결정

MVP에서 username은 다음 우선순위로 결정:

1. `.proof-flow/config.json`에 명시된 값
2. `git config user.name`
3. OS 사용자명
4. 기본값 `"local"`

### Consequences

**Positive:**
- 서버 개발/운영 비용 없음 (MVP~Phase 2)
- Mathlib4 같은 대형 Git 프로젝트에서 자연스러운 데이터 공유
- 사용자별 분리로 프라이버시와 공유의 균형

**Negative:**
- Git 레포 크기 증가 (checkpoint 파일). `.gitignore` 가이드 제공으로 완화.
- 실시간 공유 불가 (push/pull 주기에 의존). SaaS Phase에서 해소.

---

## ADR-005: Graph Kernel Extension Point

### Context

ProofFlow v0.3의 패턴 분석은 `errorCategory:tacticKey` 기반 flat 카운팅이다. 이는 유용하지만, 증명의 **구조적 맥락**을 반영하지 못한다. 같은 TYPE_MISMATCH라도 induction 기반 증명과 cases 분석 기반 증명에서는 본질적으로 다른 문제일 수 있다.

Graph Kernel(특히 Weisfeiler-Leman)을 적용하면 DAG의 구조적 fingerprint를 계산하여 "이런 모양의 증명 구조에서 이 tactic이 효과적이었다"는 구조 조건부 통계가 가능해진다. 이는 ProofFlow를 단순 도구에서 **증명 전략의 실증적 연구 플랫폼**으로 진화시키는 핵심이다.

### Decision

**PatternEntry 스키마를 DAG fingerprint-ready로 설계하되, fingerprint 계산 자체는 v0.3 이후로 미룬다.**

#### 스키마 설계 (v0.3부터 적용)

```typescript
type PatternEntry = {
  // 기존 (v0.3)
  key: string;                    // `${errorCategory}:${tacticKey}`
  errorCategory: ErrorCategory;
  tacticKey: string;
  successCount: number;
  failureCount: number;
  score: number;
  lastUpdated: number;

  // Extension point (v0.3에서는 null, 향후 채움)
  dagFingerprint: string | null;  // WL kernel hash
  dagClusterId: string | null;    // 클러스터 ID (커뮤니티 집계 시)
  goalSignature: string | null;   // goal 타입 시그니처 해시
};
```

#### Fingerprint 계산 위치

```
┌──────────────────────────────────────────┐
│              Host 영역                    │
│                                          │
│  WL Kernel 계산                          │
│  - 입력: ProofDAG (이미 추출/검증됨)      │
│  - 초기 라벨: kind + status.kind          │
│  - k번 이웃 해싱 반복                     │
│  - 출력: fingerprint string              │
│                                          │
│  → AttemptRecord에 fingerprint 포함하여   │
│    Core에 전달                            │
└──────────────────────────────────────────┘
```

WL Kernel 계산은 **Host effect**에 속한다. 이유:
- ProofDAG를 입력으로 받는 순수 계산이지만, 계산 비용이 있고 선택적(opt-in)이므로 Core의 필수 경로에 넣지 않음
- Host가 DAG 추출 시 fingerprint를 함께 계산하여 정제된 결과에 포함하는 것이 자연스러움
- Core는 fingerprint가 null이면 무시, 있으면 조건부 통계에 활용

#### 패턴 키 확장

```
v0.3:   errorCategory:tacticKey           → "TYPE_MISMATCH:simp"
v0.3.5: errorCategory:tacticKey:fingerprint → "TYPE_MISMATCH:simp:0xA3F2..."
```

fingerprint가 null인 기존 데이터는 전역 통계로 유지되고, fingerprint가 있는 새 데이터는 구조 조건부 통계로 누적된다. **하위 호환성이 자동으로 보장됨.**

### Rationale

1. **스키마를 먼저 확장해두는 이유**: 나중에 fingerprint를 추가하려면 기존 PatternEntry 마이그레이션이 필요. null 필드를 미리 두면 마이그레이션 비용 제로.
2. **Host에 두는 이유**: ADR-002 "선물상자 원칙"과 일관됨. fingerprint 계산은 Core가 모르는 구현 상세.
3. **구조 조건부 통계의 가치**: "이 에러에 이 tactic이 좋다"(전역)보다 "이 구조의 증명에서 이 에러에 이 tactic이 좋다"(구조 조건부)가 해상도가 높음. 이것이 ProofFlow를 연구 플랫폼으로 만드는 핵심 차별점.

### Consequences

**Positive:**
- v0.3 MVP에는 구현 부담 없음 (nullable 필드만 추가)
- 마이그레이션 없이 fingerprint 활성화 가능
- 커뮤니티 집계 시 구조적 클러스터링의 기반

**Negative:**
- nullable 필드가 스키마를 다소 복잡하게 함
- fingerprint 활성화 전까지는 "미래를 위한 예약 필드"에 불과

### Future: 연구 플랫폼으로의 진화

Graph Kernel이 활성화되면 다음이 가능해진다:

1. **유사 증명 검색**: "이 DAG와 구조가 비슷한 과거 증명"을 찾아 성공한 tactic sequence 추천
2. **증명 진화 궤적 분석**: World lineage를 따라가며 DAG 간 거리를 측정, 증명 전략 유형 클러스터링
3. **LLM 컨텍스트 최적화 (v0.4)**: 유사 증명의 성공 패턴을 few-shot context로 LLM에 전달
4. **커뮤니티 증명 전략 지도 (Phase 3)**: Mathlib 전체에 걸친 fingerprint 클러스터별 통계

이 모든 것의 전제가 "PatternEntry에 fingerprint 필드가 있는가"이므로, v0.3에서 nullable로 예약해두는 결정은 비용 대비 옵션 가치가 높다.

---

## Cross-Reference

| ADR | Depends On | Enables |
|-----|-----------|---------|
| ADR-001 (Manifesto-Native) | Manifesto App SPEC v2.0.0 | ADR-002, ADR-003, ADR-004 |
| ADR-002 (Host Boundary) | ADR-001, Manifesto ADR-001 | Host 구현, Core 테스트 전략 |
| ADR-003 (Single-Actor) | Manifesto World SPEC v2.0.2 | MVP 단순화 |
| ADR-004 (Git-First) | ADR-001 (WorldStore) | Phase 2 공유, Phase 3 SaaS |
| ADR-005 (Graph Kernel) | ADR-002 (Host에서 계산) | 연구 플랫폼 진화 |

---

## Summary

다섯 개의 결정을 한 문장으로:

> **ProofFlow는 Manifesto 위에서 태어나고(ADR-001), Host가 Lean의 혼돈을 정제하여 Core에 선물하고(ADR-002), 단일 사용자가 자유롭게 증명을 탐색하며(ADR-003), Git이 지식 공유의 첫 번째 채널이 되고(ADR-004), Graph Kernel이 미래의 연구 플랫폼으로 가는 문을 열어둔다(ADR-005).**
