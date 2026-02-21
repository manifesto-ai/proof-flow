# ProofFlow: Lean 증명 탐색/가시화 도구

## Product Requirements Document (PRD) v2

- **버전:** v2.0 (Manifesto-Native Rewrite)
- **작성:** 정성우 (Sungwoo Jung)
- **일자:** 2026-02-04
- **상태:** Draft
- **라이선스:** MIT (Open Source)
- **선행 문서:** ProofFlow ADRs (ADR-001 ~ ADR-005)

---

## 0. 한 줄 요약

**Manifesto 프레임워크 위에서 Lean 4 증명의 구조를 DAG로 시각화하고, 시도/실패 이력과 패턴 통계를 World lineage로 누적하여, 개인의 증명 개발을 가속하고 커뮤니티의 증명 전략 지식을 축적하는 VS Code 확장.**

---

## 1. 문제 정의

Lean 4 사용자는 증명을 "선형 텍스트"로 작성하지만, 실제 증명은 goal → subgoal로 분기하고, tactic 실패로 여러 경로를 시도하며, 숨겨진 의존성이 생긴다.

현재 Lean 4 VS Code 환경의 기본 UX는 "커서 위치의 상태(Infoview)"에 강하게 묶여 있어 다음이 어렵다:

- 증명 전체 구조를 한눈에 파악
- 어떤 subgoal이 해결/정체/미시작인지 즉시 확인
- 같은 goal에서 이전에 무엇을 시도했는지 기록/회고
- "내가 반복하는 실패 패턴"을 인식

이 문제는 "수학 지식 부족"이 아니라 **가시성(visibility)과 워크플로우(workflow)의 결핍**이다.

---

## 2. 제품 정체성

### 2.1 이중 정체성

ProofFlow는 두 가지 역할을 동시에 수행한다:

**제품으로서:** Lean 4 사용자를 위한 증명 탐색/가시화 도구. 즉각적인 사용 가치를 제공해야 한다.

**쇼케이스로서:** Manifesto 프레임워크의 실용성을 입증하는 레퍼런스 구현. Manifesto가 실제 제품을 만들 수 있다는 것을 증명해야 한다. 저장, 히스토리, 재진입, 이벤트 시스템 등 Manifesto가 제공하는 인프라를 직접 구현하지 않고 프레임워크에 위임함으로써 "프레임워크가 일한다"는 것을 보여준다.

### 2.2 목표

- **증명 구조 가시화:** 파일/정리 단위의 proof structure를 DAG로 시각화
- **탐색 이력 누적:** 시도/실패를 World lineage로 기록하여 반복 시도를 줄임
- **패턴 기반 인사이트:** AI 없이도 "내가 자주 겪는 실패 유형"과 "효과적이었던 tactic"을 통계로 보여줌
- **Manifesto 프레임워크 실증:** World/Host/Core 분리, immutable history, deterministic replay를 실제 제품에서 구현

### 2.3 비목표 (v0.1–v0.3)

- 자동 증명 생성(LLM) — v0.4 이후 opt-in
- Lean 4 확장(lean4) 또는 Infoview 대체
- 서버/계정/클라우드/텔레메트리
- 인터넷 연결 필수
- Manifesto 독자 저장 메커니즘 — WorldStore에 위임

---

## 3. 사용자 페르소나

### 3.1 1차: Lean Proof Author (개인 연구자)

증명을 작성하는 사람. 큰 파일에서 구조를 잃지 않고, 막힌 goal에 대해 "내가 이미 뭘 해봤는지" 보고 싶다. Infoview + ProofFlow 패널을 함께 두고, DAG로 방향 잡고 노드 클릭으로 이동한다.

### 3.2 2차: Lean Educator (교수/TA)

학생들에게 "증명 구조"를 시각적으로 보여주고, 어디서 막혔는지 빠르게 확인한다. DAG를 기준으로 설명하고, World lineage를 통해 학생의 증명 과정을 추적한다.

### 3.3 3차: 증명 전략 연구자 (Phase 2 이후)

ProofFlow가 생성한 데이터를 분석하는 사람. DAG fingerprint 기반 클러스터링, 증명 진화 궤적 분석, 커뮤니티 수준의 tactic 성공률 통계에 관심이 있다. 이 페르소나는 직접 ProofFlow를 쓰기보다 ProofFlow가 축적한 데이터를 연구한다.

---

## 4. 성공 지표

### 4.1 1층 지표 (도구로서의 채택)

| Metric | Target (출시 후 6개월) |
|---|---:|
| VS Code Marketplace 설치 | 500+ |
| 주간 활성 사용자 | 100+ |
| GitHub stars | 300+ |
| Lean Zulip 언급 | 20+ threads |
| "증명 완료 시간 감소" 자기보고 | 20%+ |

### 4.2 2층 지표 (데이터 플랫폼으로서의 가치)

| Metric | Target (Phase 2 이후) |
|---|---:|
| 누적 AttemptRecord 수 (공개 레포) | 50,000+ |
| DAG fingerprint 클러스터 수 | 100+ distinct |
| Git으로 `.proof-flow/` 공유하는 레포 수 | 10+ |
| 패턴 기반 추천의 적중률 | 30%+ |

---

## 5. Manifesto 정렬

> 상세 설계 근거는 ProofFlow ADRs 문서를 참조한다.

### 5.1 아키텍처 매핑

| Manifesto Layer | ProofFlow에서의 역할 |
|---|---|
| **Core** | 정제된 ProofDAG/AttemptRecord를 받아 state patch 생성. LSP, 파일시스템, VS Code를 모름. |
| **Host** | Lean LSP 호출, diagnostics 파싱, DAG 추출, Zod validation, VS Code API 호출. "선물상자를 여는" 역할. |
| **World** | 모든 상태 변경을 Proposal → World로 봉인. Lineage가 증명 과정의 완전한 이력. |
| **App** | VS Code extension이 곧 App. Host와 World를 조립하고, extension lifecycle을 Manifesto lifecycle에 매핑. |

### 5.2 준수 수준

App SPEC v2.0.0 **Minimal Compliance**를 목표로 한다:

- App interface (§6) ✓
- Lifecycle state machine (§7) ✓ — VS Code activate/deactivate 매핑
- HostExecutor (§8) ✓ — Lean LSP + VS Code API wrapping
- WorldStore core operations (§9) ✓ — 로컬 파일시스템, Delta + Checkpoint
- Layer boundaries (§4) ✓

Standard/Full Compliance 요소(Branch, Schema Registry, Memory, Plugins)는 v0.4 이후 점진 도입.

### 5.3 거버넌스 (ADR-003)

- Single Actor: `proof-flow:local-user`
- Auto-Approve Authority: 모든 Proposal 즉시 승인
- ExecutionKey: Proposal당 고유 (최대 병렬성)

### 5.4 저장 (ADR-001, ADR-004)

- WorldStore가 모든 영속성 담당
- `.proof-flow/worlds/{username}/` 디렉토리 구조
- Git으로 공유 가능 (사용자별 파일 분리로 merge conflict 방지)

---

## 6. 도메인 데이터 모델

> ADR-001에 의해 `StorageState`, `BuffersState`는 도메인에서 제거. WorldStore가 담당.

### 6.1 핵심 타입

```typescript
// === 증명 구조 (v0.1) ===

type ProofNode = {
  id: string;
  kind: NodeKind;           // "theorem" | "have" | "suffices" | ...
  label: string;
  leanRange: Range;
  goal: string | null;
  status: NodeStatus;       // resolved | error | sorry | in_progress
  children: string[];
  dependencies: string[];
};

type ProofDAG = {
  fileUri: string;
  rootIds: string[];
  nodes: Record<string, ProofNode>;
  extractedAt: number;
  metrics: DagMetrics | null;
};

// === 시도 기록 (v0.2) ===

type AttemptRecord = {
  id: string;
  fileUri: string;
  nodeId: string;
  timestamp: number;
  tactic: string;
  tacticKey: string;
  result: AttemptResult;     // "success" | "error" | "timeout" | "placeholder"
  contextErrorCategory: ErrorCategory | null;
  errorMessage: string | null;
  durationMs: number | null;
};

// === 패턴 DB (v0.3) ===

type PatternEntry = {
  key: string;               // `${errorCategory}:${tacticKey}`
  errorCategory: ErrorCategory;
  tacticKey: string;
  successCount: number;
  failureCount: number;
  score: number;
  lastUpdated: number;

  // Graph Kernel extension point (ADR-005)
  dagFingerprint: string | null;
  dagClusterId: string | null;
  goalSignature: string | null;
};
```

### 6.2 도메인 상태 (Snapshot.data)

```typescript
type ProofFlowState = {
  appVersion: string;

  workspace: {
    uri: string | null;
    openedAt: number | null;
  };

  // v0.1: 파일별 최신 DAG
  files: Record<string, {
    fileUri: string;
    dag: ProofDAG | null;
    lastSyncedAt: number | null;
  }>;

  // v0.2: 시도 이력
  // attempts를 Record로 관리 — patch-only append, Array 불필요
  history: {
    version: string;
    files: Record<string, {
      fileUri: string;
      nodes: Record<string, {
        nodeId: string;
        attempts: Record<string, AttemptRecord>;
        currentStreak: number;
        totalAttempts: number;
        lastAttemptAt: number | null;
        lastSuccessAt: number | null;
        lastFailureAt: number | null;
      }>;
      totalAttempts: number;
      updatedAt: number | null;
    }>;
  };

  // v0.3: 패턴 DB
  patterns: {
    version: string;
    entries: Record<string, PatternEntry>;
    totalAttempts: number;
    updatedAt: number | null;
  };

  // UI 상태
  ui: {
    panelVisible: boolean;
    activeFileUri: string | null;
    selectedNodeId: string | null;
    cursorNodeId: string | null;
    layout: "topDown" | "leftRight";
    zoom: number;
    collapseResolved: boolean;
  };

  // v0.4+ 확장 대비
  integrations: {
    llm: {
      enabled: boolean;
      provider: "openai" | "anthropic" | "none";
      maxSuggestionsPerGoal: number;
    };
  };
};
```

**제거된 것들과 그 이유:**

| 제거됨 | 이유 | 대체 |
|---|---|---|
| `StorageState` | WorldStore가 저장 담당 | WorldStore Delta/Checkpoint |
| `BuffersState` | Host effect 결과는 Patch로 반환 | Host → Patch[] |
| `storage.historyPath/patternsPath` | WorldStore 내부 구현 | WorldStore config |
| `storage.historyDirty/patternsDirty` | WorldStore가 persistence 관리 | WorldStore flush policy |
| `WriteResult` | Effect 실패는 Patch로 기록 | Host effect contract |
| `flush()` action | WorldStore persistence | WorldStore checkpoint policy |

---

## 7. Host Effect 계약

> ADR-002 "선물상자 원칙"에 의해 정의.

Host는 외부 세계(Lean LSP, VS Code, 파일시스템)의 혼돈을 정리하여 Zod-validated 타입으로 Core에 전달한다. Core가 선언하는 effect는 도메인 의미 단위이며, 이행 방법은 Host의 자유이다.

### 7.1 필수 Effects

| Effect | Input | Output | 버전 |
|---|---|---|---|
| `proof_flow.dag.extract` | `{ fileUri }` | `ProofDAG` (Zod-validated) | v0.1 |
| `proof_flow.attempt.detect` | `{ fileUri, nodeId }` | `AttemptRecord` (Zod-validated) | v0.2 |
| `proof_flow.editor.reveal` | `{ fileUri, range }` | `void` | v0.1 |
| `proof_flow.editor.getCursor` | `{}` | `{ fileUri, position }` | v0.1 |

### 7.2 Host의 내부 구현 (도메인이 모르는 것)

`proof_flow.dag.extract` effect의 이행 과정:

```
1. Lean LSP에 diagnostics 요청
2. (가능하면) goal state, infoTree 요청
3. Raw diagnostics 파싱 → 노드/엣지 식별
4. NodeKind 분류 (theorem/have/suffices/calc_step/case/sorry)
5. NodeStatus 판정 (resolved/error/sorry/in_progress)
6. ErrorCategory 패턴매칭 (TYPE_MISMATCH, UNKNOWN_IDENT, ...)
7. Zod schema validation
8. → 정제된 ProofDAG 반환
```

Core는 이 과정을 모른다. Core가 아는 것은 "ProofDAG를 달라고 요청하면, 유효한 ProofDAG가 온다"는 계약뿐이다.

---

## 8. Intent 설계

ProofFlow에서 Intent는 사용자의 상호작용 또는 외부 이벤트가 Proposal로 변환된 것이다. 모든 Intent는 Proposal → Auto-Approve → Host 실행 → World 생성 흐름을 따른다.

### 8.1 v0.1 Intents

| Intent | 입력 | 트리거 | 결과 |
|---|---|---|---|
| `dag.sync` | `fileUri` | Lean recheck 완료 | DAG effect 호출 → state patch |
| `file.activate` | `fileUri` | 에디터 탭 전환 | `ui.activeFileUri` 업데이트 |
| `node.select` | `fileUri, nodeId` | DAG 노드 클릭 | `ui.selectedNodeId` + editor reveal effect |
| `cursor.sync` | `fileUri, nodeId \| null` | 커서 이동 | `ui.cursorNodeId` 업데이트 |
| `panel.toggle` | — | 커맨드 실행 | `ui.panelVisible` 토글 |
| `layout.set` | `layout` | 사용자 선택 | `ui.layout` 업데이트 |

### 8.2 v0.2 Intents

| Intent | 입력 | 트리거 | 결과 |
|---|---|---|---|
| `attempt.record` | `fileUri, nodeId, tactic, tacticKey, result, contextErrorCategory, errorMessage, durationMs` | recheck 후 노드 상태 변화 감지 | history append (Record patch) |
| `history.clear` | — | 사용자 명령 | history 초기화 |

### 8.3 v0.3 Intents

| Intent | 입력 | 트리거 | 결과 |
|---|---|---|---|
| `patterns.update` | (attempt.record와 연쇄) | attempt 기록 시 자동 | PatternEntry 카운트 업데이트 |
| `patterns.reset` | — | 사용자 명령 | patterns 초기화 |

**설계 원칙:** `attempt.record`와 `patterns.update`는 동일한 Proposal 내에서 하나의 action으로 처리된다. 두 개의 별도 Proposal이 아니라, 하나의 Intent가 history와 patterns를 함께 업데이트한다. 이것이 상태 일관성을 보장한다.

---

## 9. UX 설계

### 9.1 v0.1 — 패널 구조 (WebView)

```
┌─────────────────────────────────────────────────────┐
│  Summary Bar: Resolved: 5/12 │ Errors: 3 │ Sorry: 2 │ In-progress: 2  │
├─────────────────────────────────────────────────────┤
│                                                     │
│                   Proof DAG                         │
│                                                     │
│   ┌──────┐                                          │
│   │thm   │──→ ┌──────┐──→ ┌──────┐                │
│   │  ✓   │    │have  │    │cases │                 │
│   └──────┘    │  ✓   │    │  ✗   │──→ ┌──────┐    │
│               └──────┘    └──────┘    │sorry │    │
│                                       │  ?   │    │
│                                       └──────┘    │
│                                                     │
├─────────────────────────────────────────────────────┤
│  Selected Node Detail                               │
│  ─────────────────                                  │
│  kind: cases │ status: error                        │
│  goal: ∀ (n : Nat), n + 0 = n                      │
│  error: tactic 'simp' failed                        │
│  range: line 42:5 – 42:28                           │
└─────────────────────────────────────────────────────┘
```

### 9.2 v0.2 — 추가 UI

- 선택 노드의 **Attempt History** 패널: 시도 목록 (tactic, 결과, 시간)
- 노드 **히트맵 오버레이**: 시도 횟수에 따른 시각적 강조 (0/1-3/4-10/10+)
- 세션 **타임라인**: World lineage 기반, 오늘의 작업 흐름 요약

### 9.3 v0.3 — 추가 UI

- **Pattern Insights** 패널: errorCategory별 tactic 성공률 통계
- 노드 **툴팁**: "내 이력에서 TYPE_MISMATCH에 norm_cast가 8/10 성공" (자동 적용 없음, 텍스트 표시만)
- 프로젝트 **대시보드**: 빈도/성공률/평균 시도 횟수

---

## 10. 버전별 요구사항

### v0.1 — Proof DAG Visualization ("증명을 보이게")

**핵심 가치:** 선형 텍스트를 구조로 바꿔 "내가 지금 어디에 있는지"를 즉시 파악한다.

#### 기능

**F1. DAG 추출 및 표시**
- Host가 `proof_flow.dag.extract` effect를 이행하여 ProofDAG 생성
- 트리거: 파일 저장 또는 Lean recheck 완료
- 노드 상태 시각화: Resolved(✓) / Error(✗) / Sorry(?) / In-progress(⋯)

**F2. 양방향 네비게이션**
- 노드 클릭 → `proof_flow.editor.reveal` effect로 소스 이동
- 커서 이동 → `cursor.sync` intent로 대응 노드 강조

**F3. Summary Bar**
- `Resolved: x/y | Errors: z | Sorry: k | In-progress: m`
- ProofDAG.metrics에서 계산 (computed)

**F4. 레이아웃/확대/접기**
- Top-Down / Left-Right 전환
- Zoom/pan
- Resolved subtree collapse

#### 승인 기준

| ID | 기준 |
|---|---|
| AC1 | 50+ 노드 그래프가 2초 내 렌더링 |
| AC2 | 노드 클릭 시 정확한 range로 에디터 이동 |
| AC3 | 커서 위치 변경이 200ms 내 노드 하이라이트에 반영 |
| AC4 | 요약 카운트가 실제 DAG 상태와 일치 |
| AC5 | 50+ 노드에서 pan/zoom이 체감 끊김 없이 동작 |
| AC6 | VS Code 재시작 후 마지막 DAG 상태 복원 (WorldStore) |

---

### v0.2 — Exploration History ("여정을 기록하자")

**핵심 가치:** 같은 goal에서 "이미 해본 삽질"을 반복하지 않게 한다. 모든 시도가 World lineage에 immutable하게 기록된다.

#### 기능

**F5. Attempt 기록**
- 트리거: Lean recheck 완료 후 노드 상태 변화 감지 (Host가 diff 판정)
- Intent `attempt.record`로 history + patterns 동시 업데이트
- Record<string, AttemptRecord> 구조로 patch-only append

**F6. 노드 히스토리 패널**
- 선택 노드의 시도 목록 표시 (timestamp 정렬)
- 각 시도의 tactic, 결과, 소요 시간, 에러 메시지

**F7. 히트맵 오버레이**
- 시도 횟수에 따라 노드 시각적 강조
- 구간: 0 / 1-3 / 4-10 / 10+

**F8. 세션 타임라인**
- World lineage 기반으로 오늘/최근 작업 흐름 요약
- 각 World가 곧 하나의 "시점" — Manifesto가 자동 관리

**F9. tactic 변경 diff 감지**
- Host가 같은 위치에서 tactic 문자열 변경을 감지하면 "새 시도"로 판정
- 감지 로직은 Host 책임 (ADR-002)

#### 승인 기준

| ID | 기준 |
|---|---|
| AC7 | recheck 완료 후 1초 내 attempt 기록 반영 |
| AC8 | 히스토리가 누락 없이 표시되고 시간순 정렬 정확 |
| AC9 | 히트맵이 0/1-3/4-10/10+ 구간을 명확히 구분 |
| AC10 | VS Code 재시작 후 전체 이력 복원 (WorldStore) |
| AC11 | World lineage에서 임의 시점의 snapshot 복원 가능 |

---

### v0.3 — Failure Pattern Analysis ("내 패턴을 보자")

**핵심 가치:** AI 없이도 "내가 어떤 실수/막힘을 반복하는지"를 통계로 드러낸다.

#### 기능

**F10. 에러 카테고리 분류 (룰 기반)**
- Host가 Lean diagnostics에서 패턴매칭으로 분류
- 카테고리: TYPE_MISMATCH, UNKNOWN_IDENT, TACTIC_FAILED, TIMEOUT, UNSOLVED_GOALS, KERNEL_ERROR, OTHER

**F11. 에러 카테고리별 tactic 성공률**
- `errorCategory:tacticKey` 키로 success/failure count 누적
- PatternEntry.score = successCount - failureCount

**F12. 노드 레벨 인사이트**
- 텍스트 라벨: "내 이력에서 TYPE_MISMATCH에 norm_cast가 8/10 성공"
- 최소 샘플(≥3) 조건에서만 표시
- 자동 적용 없음 — 정보 제공만

**F13. 프로젝트 대시보드**
- 전체 빈도/성공률/평균 시도 횟수
- ErrorCategory별 분포
- 가장 많이 시도된 노드 Top 10

**F14. Reset/Export**
- 패턴 초기화 (`patterns.reset` intent)
- 패턴 데이터 내보내기 (JSON)

**F15. Graph Kernel Extension Point (ADR-005)**
- PatternEntry에 `dagFingerprint`, `dagClusterId`, `goalSignature` 필드 예약 (nullable)
- v0.3에서는 null, v0.3.5 이후에서 Host가 WL kernel 계산하여 채움
- 하위 호환: null이면 전역 통계, 값이 있으면 구조 조건부 통계

#### 승인 기준

| ID | 기준 |
|---|---|
| AC12 | 표준 Lean 에러에서 카테고리 분류 정확도 > 90% |
| AC13 | 최소 샘플(≥3)일 때만 인사이트 노출 |
| AC14 | 성공률 계산 정확 |
| AC15 | 10,000 attempts에서도 대시보드 렌더 < 500ms |
| AC16 | PatternEntry에 nullable extension 필드 존재 |

---

## 11. 기술 스택 및 환경

### 11.1 타겟 환경

| 항목 | 값 |
|---|---|
| VS Code | 최소 1.85+ |
| Lean 4 toolchain | Stable (lean4 extension 호환) |
| lean4 VS Code 확장 | 공존 (의존하되 대체하지 않음) |
| Node.js (extension host) | VS Code 번들 버전 |
| WebView 렌더링 | React + D3 (또는 ELK) |

### 11.2 Manifesto 의존

| 패키지 | 역할 |
|---|---|
| `manifesto-ai-core` | Semantic computation, Snapshot, compute/apply |
| `manifesto-ai-host` | Execution engine, event-loop, effect execution |
| `manifesto-ai-world` | Governance, lineage, WorldId, WorldStore |
| `manifesto-ai-app` | Composition root (VS Code extension이 App) |

### 11.3 VS Code Extension ↔ Manifesto Lifecycle 매핑

```
VS Code activate()
  → App.create(config)
  → App.ready()
  → genesis World 생성 (또는 WorldStore에서 복원)

VS Code 사용 중
  → 사용자 상호작용/Lean 이벤트 → Intent → Proposal → World 생성

VS Code deactivate()
  → App.dispose()
  → WorldStore flush (마지막 checkpoint)
```

---

## 12. 저장 및 공유 전략

### 12.1 물리적 저장 구조 (ADR-004)

```
{workspace}/
└── .proof-flow/
    └── worlds/
        ├── {username}/           # WorldStore per user
        │   ├── checkpoints/      # Full snapshot (중요 시점)
        │   ├── deltas/           # 변경분만 (일반 World)
        │   └── index.json        # WorldIndex (빠른 탐색)
        └── config.json           # 공유 설정
```

### 12.2 Username 결정 우선순위

1. `.proof-flow/config.json`에 명시된 값
2. `git config user.name`
3. OS 사용자명
4. 기본값 `"local"`

### 12.3 Git 연동

- `.gitignore` 가능 (개인 전용)
- 커밋 가능 (팀 공유) — 사용자별 디렉토리 분리로 merge conflict 없음
- Phase 2에서 다른 사용자 디렉토리 읽어 merged view 제공

### 12.4 용량 가이드

WorldStore의 Checkpoint/Delta/Compaction 정책에 의해 자동 관리. 10,000 attempts 기준 전체 `.proof-flow/` < 20MB 목표.

---

## 13. 개발 계획

### Phase 1: MVP (4–5주)

| 주차 | 내용 |
|---|---|
| Week 0 | **Day 1 스파이크**: Lean LSP에서 추출 가능한 정보의 현실적 상한 검증 |
| Week 1 | v0.1 — DAG 추출 + 렌더링 + 네비게이션 + Manifesto 통합 |
| Week 2 | v0.1 안정화 + v0.2 시작 (attempt 기록) |
| Week 3 | v0.2 완성 (히스토리 패널 + 히트맵) + v0.3 시작 |
| Week 4 | v0.3 완성 (패턴 분석 + 대시보드) |
| Week 5 | 안정화, 문서, 데모, Marketplace 출시 |

### Phase 2: 공유 + 연구 (출시 후)

- Git 기반 팀 공유 (merged view)
- Graph Kernel 활성화 (v0.3.5)
- 증명 진화 궤적 분석 (World lineage + DAG fingerprint)

### Phase 3: 확장 (장기)

- SaaS 옵션 (커뮤니티 지식 그래프)
- LLM tactic suggestion (v0.4)
- Multi-actor 거버넌스

---

## 14. 리스크 / 대응

| 리스크 | 확률 | 영향 | 대응 |
|---|:---:|:---:|---|
| LSP/InfoTree로 "전체 구조"를 충분히 못 얻음 | 중 | 상 | **Week 0 Day 1 스파이크.** 단계적 degrade: infoTree → diagnostics-only → AST 파싱 fallback |
| 노드 ID 안정성 (편집 시 동일 노드 매칭) | 중 | 상 | Range 기반 + 구조 해시 기반 혼합 ID 전략 |
| DAG 추출의 비결정론성 (elaboration 순서) | 중 | 상 | 동일 파일 2회 추출 시 동일 DAG 보장 검증. 불가하면 정규화 단계 추가 |
| 대형 파일에서 WebView 성능 이슈 | 중 | 중 | Subtree collapse, incremental layout, 가상화 |
| Lean4 extension API 변경 | 중 | 중 | 버전 핀 + 호환 레이어 + 회귀 테스트 |
| Manifesto 프레임워크 미성숙 | 중 | 중 | 이슈 발견 시 프레임워크에 기여. ProofFlow가 곧 통합 테스트. |
| WorldStore 크기 폭발 | 저 | 중 | Compaction 정책 활용. Active Horizon 설정으로 오래된 delta 압축 |

---

## 15. 오픈 질문

| ID | 질문 | 해결 시점 |
|---|---|---|
| Q1 | Lean LSP가 제공하는 "proof structure"의 현실적 상한은? | Week 0 스파이크 |
| Q2 | InfoTree 접근이 VS Code 확장에서 가능한가? 불가하면 대안은? | Week 0 스파이크 |
| Q3 | `calc`, `conv` 같은 구조는 DAG로 어떻게 매핑? | Week 1 구현 중 |
| Q4 | 노드 동일성을 편집 후에도 어떻게 유지? | Week 1 구현 중 |
| Q5 | VS Code extension activate/deactivate가 Manifesto App lifecycle과 정확히 어떻게 매핑되는가? | Week 1 구현 중 |
| Q6 | WorldStore의 Checkpoint 주기를 어떻게 결정할 것인가? (매 N번째 World? 시간 기반?) | Week 2 |

---

## Appendix A. v0.4 — LLM Tactic Suggestions (미래)

- LLM은 "생성기"일 뿐, 결정권 없음
- Lean 타입체커가 사실상 Authority 역할
- "Try" 버튼으로 사용자 확인을 남김 (자동 적용 없음)
- Graph Kernel fingerprint를 few-shot context로 LLM에 전달하여 구조 인식 추천

## Appendix B. Graph Kernel 연구 플랫폼 진화 경로

Graph Kernel(ADR-005)이 활성화되면:

1. **유사 증명 검색**: WL kernel fingerprint 기반, 구조가 비슷한 과거 증명에서 성공한 tactic sequence 추천
2. **증명 진화 궤적 분석**: World lineage를 따라가며 인접 DAG 간 거리 측정 → 증명 전략 유형 클러스터링
3. **커뮤니티 증명 전략 지도** (Phase 3): Mathlib 전체에 걸친 fingerprint 클러스터별 통계
4. **수학 교육 연구**: "숙련된 수학자는 어떤 전략 패턴을 보이는가"에 대한 실증적 데이터

---

## References

- ProofFlow ADRs (ADR-001 ~ ADR-005)
- Manifesto App SPEC v2.0.0
- Manifesto World SPEC v2.0.2
- Manifesto Host Contract v2.0.2
- Manifesto ARCHITECTURE v2.0.0
- Manifesto ADR-001: Layer Separation
