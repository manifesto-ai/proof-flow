# ProofFlow Domain Specification v0.1.0

> **Status:** Draft  
> **Scope:** ProofFlow VS Code Extension — Lean 4 Proof Exploration & Visualization  
> **Compatible with:**
> - Core SPEC v2.0.0 + v2.0.1 patch (reserved namespace policy)
> - Host Contract v2.0.2
> - World Protocol v2.0.2 + v2.0.3 patch (`$mel` hash exclusion)
> - App SPEC v2.0.0 + v2.1.0 patch (`$mel` namespace injection)
> - MEL SPEC v0.5.0 (`onceIntent`, `$mel.guards`)
>
> **Implements:** ProofFlow ADR-001 ~ ADR-005  
> **Authors:** Sungwoo Jung (정성우)  
> **License:** MIT  
> **Changelog:**
> - **v0.1.0 (2026-02-04):** Initial draft — Manifesto-contract-native specification

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Normative Language](#2-normative-language)
3. [Scope & Non-Goals](#3-scope--non-goals)
4. [Layering & Boundary](#4-layering--boundary)
5. [Domain Definition (MEL Source)](#5-domain-definition-mel-source)
6. [DomainSchema (Core IR)](#6-domainschema-core-ir)
7. [Effect Handlers (ServiceMap)](#9-effect-handlers-servicemap)
8. [AppConfig Instantiation](#10-appconfig-instantiation)
9. [VS Code ↔ Manifesto Lifecycle](#11-vs-code--manifesto-lifecycle)
10. [WorldStore Configuration](#12-worldstore-configuration)
11. [Error Taxonomy](#13-error-taxonomy)
12. [Forbidden Patterns](#14-forbidden-patterns)
13. [Invariants](#15-invariants)
14. [Compliance](#16-compliance)
15. [Extension Points](#17-extension-points)
16. [References](#18-references)

---

## 1. Purpose

This document is the **normative technical specification** for ProofFlow, defined entirely in terms of **Manifesto framework contracts**.

Every state transition in ProofFlow MUST flow through `App.act()` → `Proposal` → `Authority` → `HostExecutor.execute()` → `World`. There is no alternative execution path.

This specification defines:

- A concrete MEL domain (§5) — the authoritative, human-readable source
- A concrete `DomainSchema` (§6) — compiled IR conforming to Core SPEC §4
- Concrete `EffectHandler` implementations (§7) — IO adapters, no domain logic
- A concrete `AppConfig` (§8) — the composition root
- **Forbidden patterns** (§12) — what implementations MUST NOT do

### 1.1 MEL-First Principle

ProofFlow actions and computed values are authored in MEL (MEL SPEC v0.5.0). The MEL compiler (`compileMelDomain()`) produces the `DomainSchema` consumed by Core.

```
packages/schema/domain.mel   ← Authoritative source (human-authored)
        │
        │ compileMelDomain()
        ▼
packages/schema/domain.ts    ← Generated DomainSchema (pure data, DO NOT EDIT)
```

§5 shows the MEL source. §6 shows the corresponding Core IR for reference and validation. Implementors author MEL; the compiler handles IR correctness.

---

## 2. Normative Language

Key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** are interpreted as described in [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

---

## 3. Scope & Non-Goals

### 3.1 Specification Versions

| Version | Scope | Status |
|---------|-------|--------|
| v0.1.x | DAG visualization, navigation | **This document (NORMATIVE)** |
| v0.2.x | Attempt history | Planned (INFORMATIVE sections) |
| v0.3.x | Pattern analysis | Planned (INFORMATIVE sections) |

### 3.2 Non-Goals

| Non-Goal | Reason |
|----------|--------|
| State management outside Manifesto | ADR-001: WorldStore handles all persistence |
| Direct LSP calls from domain logic | ADR-002: Host boundary |
| Custom event/pub-sub systems | Manifesto hooks system (App SPEC §17) |
| React/Zustand/Redux state stores | All state lives in `Snapshot.data` |

---

## 4. Layering & Boundary

### 4.1 Package Structure (NORMATIVE)

```
proof-flow/
├── packages/
│   ├── schema/                  # DomainSchema definition
│   │   ├── domain.mel           # MEL source (authoritative)
│   │   ├── domain.ts            # Compiled DomainSchema (generated)
│   │   └── index.ts
│   ├── host/                    # Effect handlers + Zod schemas
│   │   ├── effects/
│   │   │   ├── dag-extract.ts   # proof_flow.dag.extract handler
│   │   │   ├── editor-reveal.ts # proof_flow.editor.reveal handler
│   │   │   └── cursor-get.ts    # proof_flow.editor.getCursor handler
│   │   ├── schemas/             # Zod validation (Host boundary)
│   │   │   ├── proof-dag.ts
│   │   │   └── proof-node.ts
│   │   ├── lean/                # Lean LSP integration (Host-internal)
│   │   │   ├── client.ts
│   │   │   └── parser.ts
│   │   └── index.ts
│   └── app/                     # VS Code extension (Composition Root)
│       ├── extension.ts         # activate/deactivate → App lifecycle
│       ├── config.ts            # AppConfig assembly
│       ├── worldstore.ts        # WorldStore implementation
│       └── webview/             # UI (presentation layer)
```

### 4.2 Import Rules (NORMATIVE)

| Package | CAN import | MUST NOT import |
|---------|------------|-----------------|
| `schema` | `@manifesto-ai/core` (types only) | `host`, `app`, `vscode`, Lean LSP, `zod` |
| `host` | `@manifesto-ai/core`, `@manifesto-ai/host`, `schema`, `zod`, `vscode`, Lean LSP | `app`, `@manifesto-ai/world` |
| `app` | `@manifesto-ai/app`, `@manifesto-ai/host`, `@manifesto-ai/world`, `schema`, `host`, `vscode` | Lean LSP directly |

| Rule ID | Level | Description |
|---------|-------|-------------|
| PKG-1 | MUST | `schema` package MUST contain zero IO imports |
| PKG-2 | MUST NOT | `schema` package MUST NOT import `zod` (Zod lives in `host`) |
| PKG-3 | MUST NOT | `host` package MUST NOT import `@manifesto-ai/world` |
| PKG-4 | MUST NOT | `app` package MUST NOT call Lean LSP directly (go through Host effects) |

### 4.3 Core Flow vs. Host Handler Responsibility

A critical design principle: **Core flows handle `ui.*` (static paths). Host handlers handle `files` (dynamic keys).**

| Concern | Responsible Layer | Reason |
|---------|-------------------|--------|
| Setting `ui.activeFileUri` | Core Flow (patch) | Static SemanticPath |
| Setting `ui.selectedNodeId` | Core Flow (patch) | Static SemanticPath |
| Creating/updating `files[uri]` entries | Host Handler (merge Patch) | URI contains dots/colons → unsafe as SemanticPath segment |
| DAG extraction + Zod validation | Host Handler | IO + validation = Host responsibility |
| Editor navigation | Host Handler (effect) | VS Code API = IO |

This separation resolves the fundamental tension between Core's static-path requirement (Core SPEC §8.4.3) and the need to key `files` by URI strings.

---

## 5. Domain Definition (MEL Source)

This is the **authoritative** ProofFlow domain definition in MEL.

**Compiler compatibility note:** The current MEL compiler (v0.3.3) does not accept
hyphens in identifiers or dotted action names. Therefore:
- Action names use underscores (e.g., `dag_sync`, `file_activate`).
- Effect namespaces use underscores (e.g., `proof_flow.dag.extract`).
- Domain-level `version "x.y.z"` is omitted (compiler does not parse it).

### 5.1 Full MEL Source

```mel
domain ProofFlow {
  // ════════════════════════════════════════════
  // Types
  // ════════════════════════════════════════════

  type NodeKind =
    "theorem" | "lemma" | "have" | "let" | "suffices" |
    "show" | "calc_step" | "case" | "sorry" | "tactic_block"

  type StatusKind = "resolved" | "error" | "sorry" | "in_progress"

  type ErrorCategory =
    "TYPE_MISMATCH" | "UNKNOWN_IDENTIFIER" | "TACTIC_FAILED" |
    "UNSOLVED_GOALS" | "TIMEOUT" | "KERNEL_ERROR" |
    "SYNTAX_ERROR" | "OTHER"

  type Range = {
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  }

  type NodeStatus = {
    kind: StatusKind,
    errorMessage: string | null,
    errorCategory: ErrorCategory | null
  }

  type ProofNode = {
    id: string,
    kind: NodeKind,
    label: string,
    leanRange: Range,
    goal: string | null,
    status: NodeStatus,
    children: Array<string>,
    dependencies: Array<string>
  }

  type DagMetrics = {
    totalNodes: number,
    resolvedCount: number,
    errorCount: number,
    sorryCount: number,
    inProgressCount: number,
    maxDepth: number
  }

  type ProofDAG = {
    fileUri: string,
    rootIds: Array<string>,
    nodes: Record<string, ProofNode>,
    extractedAt: number,
    metrics: DagMetrics | null
  }

  type FileState = {
    fileUri: string,
    dag: ProofDAG | null,
    lastSyncedAt: number | null
  }

  type LayoutDirection = "topDown" | "leftRight"

  // Named types for state composite fields (MEL: no inline object types in state)
  type UiState = {
    panelVisible: boolean,
    activeFileUri: string | null,
    selectedNodeId: string | null,
    cursorNodeId: string | null,
    layout: LayoutDirection,
    zoom: number,
    collapseResolved: boolean
  }

  // Placeholder for INFORMATIVE v0.2/v0.3 fields (MEL: no `any` primitive)
  type JsonValue = string | number | boolean | null
  type HistoryState = { version: string, files: Record<string, JsonValue> }
  type PatternsState = {
    version: string,
    entries: Record<string, JsonValue>,
    totalAttempts: number,
    updatedAt: number | null
  }

  // ════════════════════════════════════════════
  // State
  // ════════════════════════════════════════════

  state {
    appVersion: string = "0.1.0"

    // Record<FileUri, FileState> — updated by Host handlers only
    files: Record<string, FileState> = {}

    // UI state — updated by Core flows only
    ui: UiState = {
      panelVisible: true,
      activeFileUri: null,
      selectedNodeId: null,
      cursorNodeId: null,
      layout: "topDown",
      zoom: 1.0,
      collapseResolved: false
    }

    // v0.2 (INFORMATIVE)
    history: HistoryState = { version: "0.2.0", files: {} }

    // v0.3 (INFORMATIVE)
    patterns: PatternsState = {
      version: "0.3.0", entries: {},
      totalAttempts: 0, updatedAt: null
    }
  }

  // ════════════════════════════════════════════
  // Computed
  // ════════════════════════════════════════════

  // Intermediate: active file's FileState (null if no file active)
  computed activeFileState =
    isNotNull(ui.activeFileUri) ? at(files, ui.activeFileUri) : null

  // Active file's DAG
  computed activeDag =
    isNotNull(activeFileState) ? activeFileState.dag : null

  // Selected node detail
  computed selectedNode =
    and(isNotNull(activeDag), isNotNull(ui.selectedNodeId))
      ? at(activeDag.nodes, ui.selectedNodeId)
      : null

  // Summary metrics (pre-computed by Host in dag.extract handler)
  computed summaryMetrics =
    isNotNull(activeDag) ? activeDag.metrics : null

  // ════════════════════════════════════════════
  // Actions
  // ════════════════════════════════════════════

  // ── dag_sync ──────────────────────────────
  // Triggers DAG extraction via Host effect.
  // Host handler updates files[fileUri] via merge patch.
  // Core flow only declares the effect; files update comes from Host.
  action dag_sync(fileUri: string) {
    onceIntent {
      effect proof_flow.dag.extract({ fileUri: fileUri })
    }
  }

  // ── file_activate ─────────────────────────
  // Pure UI state change. No effects.
  // Does NOT create FileState — that's Host's job when dag_sync runs.
  action file_activate(fileUri: string) {
    when neq(ui.activeFileUri, fileUri) {
      patch ui.activeFileUri = fileUri
      patch ui.selectedNodeId = null
      patch ui.cursorNodeId = null
    }
  }

  // ── node_select ───────────────────────────
  // Sets UI selection + navigates editor via effect.
  action node_select(nodeId: string)
    available when and(isNotNull(activeDag), isNotNull(ui.activeFileUri))
  {
    when isNotNull(at(activeDag.nodes, nodeId)) {
      patch ui.selectedNodeId = nodeId

      onceIntent {
        effect proof_flow.editor.reveal({
          fileUri: ui.activeFileUri,
          range: at(activeDag.nodes, nodeId).leanRange
        })
      }
    }
  }

  // ── cursor_sync ───────────────────────────
  // Host resolves cursor→nodeId before dispatching.
  action cursor_sync(resolvedNodeId: string | null) {
    when true {
      patch ui.cursorNodeId = resolvedNodeId
    }
  }

  // ── panel_toggle ──────────────────────────
  action panel_toggle() {
    when true {
      patch ui.panelVisible = not(ui.panelVisible)
    }
  }

  // ── layout_set ────────────────────────────
  action layout_set(layout: LayoutDirection) {
    when true {
      patch ui.layout = layout
    }
  }

  // ── zoom_set ──────────────────────────────
  action zoom_set(zoom: number) {
    when true {
      patch ui.zoom = clamp(zoom, 0.1, 5.0)
    }
  }

  // ── collapse_toggle ───────────────────────
  action collapse_toggle() {
    when true {
      patch ui.collapseResolved = not(ui.collapseResolved)
    }
  }
}
```

### 5.2 Key Design Decisions in MEL Source

**5.2.1 `onceIntent` for re-entry safety**

`dag_sync` wraps the effect declaration in `onceIntent { ... }`. This compiles to a guard check against `$mel.guards.intent.<guardId>`:

```
First compute():  guard not set → declare effect → set guard → return 'pending'
Re-entry compute(): guard already set → skip onceIntent block → flow completes
```

The guard lives in `$mel.guards.intent.*` (MEL SPEC §21, App SPEC v2.1.0 patch). It is:
- Auto-injected by App via `withPlatformNamespaces()` (APP-NS-1)
- Excluded from World hash (WORLD-HASH-4b, World SPEC v2.0.3 patch)
- Normalized on snapshot restore (APP-NS-4)

Without `onceIntent`, the effect would be re-declared on every re-entry, creating an infinite loop.

**5.2.2 `at()` for Record indexing**

MEL's `files[uri]` syntax desugars to `at(files, uri)` (MEL SPEC §9, FDR-MEL-035). This is a first-class `ExprNode` in Core (Core SPEC §7.2: `{ kind: 'at', array: ExprNode, index: ExprNode }`).

This avoids embedding URI strings as SemanticPath segments. The path `files` is static; the key lookup is a runtime expression.

**5.2.3 Core flows touch `ui.*` only; Host handles `files`**

`dag_sync` does NOT patch `files[fileUri]` — it only declares the effect. The Host handler returns merge patches at the `files` level:

```typescript
// Host handler returns:
[{ op: 'merge', path: 'files', value: { [fileUri]: fileState } }]
```

`path: 'files'` is a valid static SemanticPath. The fileUri becomes an object key in the merge value, never a path segment. This eliminates the URI-as-path-segment problem.

**5.2.4 Null-only semantics with `T | null`**

MEL has no `T?` type suffix, no `undefined`. Nullable fields use union `T | null`. All existence checks use `isNotNull()`. This aligns with Core's canonicalization (Core SPEC §15: `undefined` is removed, `null` is preserved) and MEL's total evaluation rule ("absent value → null").

**5.2.5 Named types for state composite fields**

MEL prohibits inline object types in `state { ... }` fields. All composite state fields use named types: `UiState`, `HistoryState`, `PatternsState`. This is a grammar requirement (MEL SPEC §4), not just a style choice.

**5.2.6 `when true` for unconditional-but-guarded actions**

MEL v0.2.1+ requires all `patch`/`effect` statements to be inside guards (`when`/`once`/`onceIntent`). Actions like `panel_toggle` that are always applicable use `when true { ... }` as the minimal guard. This satisfies FDR-MEL-020 while preserving semantic clarity.

**5.2.7 `available when` for UI preconditions**

`node_select` declares `available when and(isNotNull(activeDag), isNotNull(ui.activeFileUri))` (MEL SPEC §13, v0.3.3). This:
- Lets WebView/Extension query action availability from schema (no scattered precondition logic)
- Separates **availability** (can this action be dispatched?) from **body guard** (within the action, should this specific node be selected?)
- Compiles to `ActionSpec.available` in Core IR, queryable via `Core.isActionAvailable()`

**5.2.8 Intermediate computed `activeFileState`**

Instead of repeating `at(files, ui.activeFileUri)` in every computed, we define `activeFileState` as an intermediate. Downstream computeds (`activeDag`, `selectedNode`, `summaryMetrics`) derive from it. This forms a clean DAG:

```
ui.activeFileUri ──→ activeFileState ──→ activeDag ──→ selectedNode
files ─────────────┘                        │
                                            └──→ summaryMetrics
```

**5.2.9 Effect params use object literal syntax**

MEL effect statements require brace-wrapped object args: `effect foo({ key: value })`, not `effect foo(key: value)`. This compiles to `{ kind: 'effect', type: 'foo', params: { key: ExprNode } }` in Core IR.

### 5.3 MEL Grammar Rules Applied

This MEL source conforms to v0.5.0 grammar. Key rules enforced:

| Issue | MEL Rule | Applied Fix |
|-------|----------|-------------|
| No inline object types in `state` | §4.3: state fields use named types | `UiState`, `HistoryState`, `PatternsState` types defined |
| All patches inside guards | FDR-MEL-020: patch/effect only in when/once/onceIntent | `when true { ... }` for unconditional actions |
| No `if...then...else` expressions | §4.5: ternary `? :` only | `isNotNull(x) ? y : null` |
| No `T?` type suffix | §5.1: use `T \| null` for nullable | `string \| null`, `ProofDAG \| null` |
| No `T[]` array type | §5.1: use `Array<T>` | `Array<string>` |
| No `any` type | §5.1: all types named or primitive | `JsonValue = string \| number \| boolean \| null` |
| No top-level effect declarations | §4.3: domain members are type/state/computed/action | Effects appear only inside action bodies |
| Effect params in braces | §4.6: `effect name({ key: val })` | `effect proof_flow.dag.extract({ fileUri: fileUri })` |
| No `$` in identifiers | FDR-MEL-045: `$` completely prohibited | All identifiers use camelCase |

### 5.4 MEL Action Rules

| Rule ID | Level | Description |
|---------|-------|-------------|
| MEL-ACTION-1 | MUST | All `patch` and `effect` statements MUST be inside `when`, `once`, or `onceIntent` guards (MEL SPEC §4.7, FDR-MEL-020) |
| MEL-ACTION-2 | MUST | Effects requiring re-entry MUST use `onceIntent` to prevent infinite re-declaration |
| MEL-ACTION-3 | MUST NOT | Actions MUST NOT patch `files.*` paths — file updates come from Host handlers |
| MEL-ACTION-4 | MUST NOT | ProofFlow MUST NOT define actions in the `system.*` namespace (READY-4) |
| MEL-ACTION-5 | SHOULD | Actions with preconditions SHOULD declare `available when` for UI queryability |

---

## 6. DomainSchema (Core IR)

This section shows the compiled Core IR for key elements, for validation and reference. **Implementors do NOT write this by hand** — the MEL compiler generates it.

### 6.1 Schema Identity

```typescript
import type { DomainSchema } from '@manifesto-ai/core';

// Generated by compileMelDomain('packages/schema/domain.mel')
export const PROOFFLOW_SCHEMA: DomainSchema = {
  id: 'mel:proofflow',
  version: '1.0.0',
  hash: '', // Computed via Core SPEC §15 canonical form
  types: { /* TypeSpec definitions from §5.1 types */ },
  state: PROOFFLOW_STATE,
  computed: PROOFFLOW_COMPUTED,
  actions: PROOFFLOW_ACTIONS,
  meta: {
    name: 'ProofFlow',
    description: 'Lean 4 Proof Exploration & Visualization',
    authors: ['Sungwoo Jung'],
  },
};
```

| Rule ID | Level | Description |
|---------|-------|-------------|
| SCHEMA-1 | MUST | Schema `id` MUST be `'mel:proofflow'` (compiler-derived from domain name) |
| SCHEMA-2 | MUST | Schema `hash` MUST be computed via Core SPEC §15 canonical form |
| SCHEMA-3 | MUST | Schema MUST pass `Core.validate()` without errors |

### 6.2 ComputedSpec (Core IR)

Note the `fields` wrapper and `computed.*` key prefix (Core SPEC §6.2).

```typescript
const PROOFFLOW_COMPUTED: ComputedSpec = {
  fields: {

    'computed.activeFileState': {
      deps: ['ui.activeFileUri', 'files'],
      expr: {
        kind: 'if',
        cond: { kind: 'isNull', arg: { kind: 'get', path: 'ui.activeFileUri' } },
        then: { kind: 'lit', value: null },
        else: {
          kind: 'at',
          array: { kind: 'get', path: 'files' },
          index: { kind: 'get', path: 'ui.activeFileUri' },
        },
      },
    },

    'computed.activeDag': {
      deps: ['computed.activeFileState'],
      expr: {
        kind: 'if',
        cond: { kind: 'isNull', arg: { kind: 'get', path: 'computed.activeFileState' } },
        then: { kind: 'lit', value: null },
        else: { kind: 'get', path: 'computed.activeFileState.dag' },
      },
    },

    'computed.selectedNode': {
      deps: ['computed.activeDag', 'ui.selectedNodeId'],
      expr: {
        kind: 'if',
        cond: {
          kind: 'or',
          args: [
            { kind: 'isNull', arg: { kind: 'get', path: 'computed.activeDag' } },
            { kind: 'isNull', arg: { kind: 'get', path: 'ui.selectedNodeId' } },
          ],
        },
        then: { kind: 'lit', value: null },
        else: {
          kind: 'at',
          array: { kind: 'get', path: 'computed.activeDag.nodes' },
          index: { kind: 'get', path: 'ui.selectedNodeId' },
        },
      },
    },

    'computed.summaryMetrics': {
      deps: ['computed.activeDag'],
      expr: {
        kind: 'if',
        cond: { kind: 'isNull', arg: { kind: 'get', path: 'computed.activeDag' } },
        then: { kind: 'lit', value: null },
        else: { kind: 'get', path: 'computed.activeDag.metrics' },
      },
    },
  },
};
```

### 6.3 dag_sync Flow (Core IR)

The `onceIntent` compiles to a guard check + `$mel.guards.intent` merge. The compiler generates a unique guardId (e.g., `dag_sync_0`).

```typescript
// Compiled from: action dag_sync(fileUri: string) { onceIntent { effect ... } }
const DAG_SYNC_FLOW: FlowNode = {
  kind: 'seq',
  steps: [
    // onceIntent guard: skip if already executed for this intent
    {
      kind: 'if',
      cond: {
        kind: 'neq',
        left: {
          kind: 'at',
          array: { kind: 'get', path: '$mel.guards.intent' },
          index: { kind: 'lit', value: 'dag_sync_0' },
        },
        right: { kind: 'get', path: 'meta.intentId' },
      },
      then: {
        kind: 'seq',
        steps: [
          // Write guard marker (COMPILER-MEL-1: merge at $mel.guards.intent)
          {
            kind: 'patch',
            op: 'merge',
            path: '$mel.guards.intent',
            value: {
              kind: 'object',
              fields: {
                dag_sync_0: { kind: 'get', path: 'meta.intentId' },
              },
            },
          },
          // Declare effect
          {
            kind: 'effect',
            type: 'proof_flow.dag.extract',
            params: {
              fileUri: { kind: 'get', path: 'input.fileUri' },
            },
          },
        ],
      },
      // else: guard matched → skip (effect already fulfilled)
    },
  ],
};
```

**Computation cycle walkthrough:**

```
Call 1: app.act('dag_sync', { fileUri: 'file:///proof.lean' })
  → Proposal → auto-approve → HostExecutor.execute()
  → Core.compute(snapshot₀, intent, context)
    → Guard check: $mel.guards.intent.dag_sync_0 ≠ meta.intentId → true
    → Merge guard marker to $mel.guards.intent
    → Effect node → Requirement recorded → returns 'pending'
  → Host reads pendingRequirements
  → Host calls Lean LSP → parse → Zod validate
  → Host returns Patch[]:
      [{ op: 'merge', path: 'files', value: { 'file:///proof.lean': { ... } } }]
  → Host: Core.apply(snapshot₁, patches) → snapshot₂
  → Host clears requirement

Call 2: Core.compute(snapshot₂, intent, context)  ← same intent, new snapshot
  → Guard check: $mel.guards.intent.dag_sync_0 == meta.intentId → false
  → Skip onceIntent block entirely
  → Flow completes (no more steps) → returns 'complete'
  → World created with terminal snapshot
```

### 6.4 node_select Flow (Core IR)

`available when` compiles to `ActionSpec.available`. The body `when` guard handles the per-node existence check.

```typescript
// ActionSpec entry (generated):
// {
//   ...
//   available: {
//     kind: 'and', args: [
//       { kind: 'not', arg: { kind: 'isNull', arg: { kind: 'get', path: 'computed.activeDag' } } },
//       { kind: 'not', arg: { kind: 'isNull', arg: { kind: 'get', path: 'ui.activeFileUri' } } },
//     ]
//   },
//   flow: NODE_SELECT_FLOW,
// }

const NODE_SELECT_FLOW: FlowNode = {
  kind: 'seq',
  steps: [
    // when guard: specific node must exist (available when already checked activeDag)
    {
      kind: 'if',
      cond: {
        kind: 'not', arg: {
          kind: 'isNull',
          arg: {
            kind: 'at',
            array: { kind: 'get', path: 'computed.activeDag.nodes' },
            index: { kind: 'get', path: 'input.nodeId' },
          },
        },
      },
      then: {
        kind: 'seq',
        steps: [
          // patch ui.selectedNodeId = input.nodeId
          {
            kind: 'patch', op: 'set', path: 'ui.selectedNodeId',
            value: { kind: 'get', path: 'input.nodeId' },
          },
          // onceIntent guard for editor.reveal effect
          {
            kind: 'if',
            cond: {
              kind: 'neq',
              left: {
                kind: 'at',
                array: { kind: 'get', path: '$mel.guards.intent' },
                index: { kind: 'lit', value: 'node_select_0' },
              },
              right: { kind: 'get', path: 'meta.intentId' },
            },
            then: {
              kind: 'seq',
              steps: [
                {
                  kind: 'patch', op: 'merge', path: '$mel.guards.intent',
                  value: {
                    kind: 'object',
                    fields: { node_select_0: { kind: 'get', path: 'meta.intentId' } },
                  },
                },
                {
                  kind: 'effect',
                  type: 'proof_flow.editor.reveal',
                  params: {
                    fileUri: { kind: 'get', path: 'ui.activeFileUri' },
                    range: {
                      kind: 'get',
                      base: {
                        kind: 'at',
                        array: { kind: 'get', path: 'computed.activeDag.nodes' },
                        index: { kind: 'get', path: 'input.nodeId' },
                      },
                      path: 'leanRange',
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
};
```

### 6.5 Simple UI Actions (Core IR)

These compile to trivial single-patch flows. No guards needed for pure UI toggles because they are idempotent.

```typescript
// panel_toggle → safe without onceIntent (toggle is inherently idempotent per-call)
const PANEL_TOGGLE_FLOW: FlowNode = {
  kind: 'patch', op: 'set', path: 'ui.panelVisible',
  value: { kind: 'not', arg: { kind: 'get', path: 'ui.panelVisible' } },
};

// layout_set
const LAYOUT_SET_FLOW: FlowNode = {
  kind: 'patch', op: 'set', path: 'ui.layout',
  value: { kind: 'get', path: 'input.layout' },
};

// zoom_set (clamp to 0.1–5.0)
const ZOOM_SET_FLOW: FlowNode = {
  kind: 'patch', op: 'set', path: 'ui.zoom',
  value: {
    kind: 'max', args: [
      { kind: 'lit', value: 0.1 },
      { kind: 'min', args: [
        { kind: 'lit', value: 5.0 },
        { kind: 'get', path: 'input.zoom' },
      ]},
    ],
  },
};

// collapse_toggle
const COLLAPSE_TOGGLE_FLOW: FlowNode = {
  kind: 'patch', op: 'set', path: 'ui.collapseResolved',
  value: { kind: 'not', arg: { kind: 'get', path: 'ui.collapseResolved' } },
};
```

> **Note on `when true` compilation:** MEL's `when true { patch ... }` compiles to the patch node directly (the compiler optimizes away `{ kind: 'if', cond: { kind: 'lit', value: true }, then: ... }` as a constant fold). The `when true` is a grammar-level requirement (FDR-MEL-020: all patches inside guards), not a runtime guard. These actions complete in a single `compute()` cycle with no re-entry.

### 6.6 Invocation Contract

Every state transition MUST go through `app.act()`:

```typescript
// ✅ CORRECT
app.act('dag_sync', { fileUri: 'file:///proof.lean' });
app.act('panel_toggle');
app.act('node_select', { nodeId: 'node-abc' });

// ❌ FORBIDDEN: See §12
```

---

## 7. Effect Handlers (ServiceMap)

Effect handlers are registered via `AppConfig.services` (App SPEC §6.1). They are **IO adapters** — they execute external operations and return `Patch[]`. They MUST NOT contain domain logic (Host Contract §7.4).

### 7.1 Registration

```typescript
import type { EffectHandler } from '@manifesto-ai/host';

export const PROOFFLOW_SERVICES: Record<string, EffectHandler> = {
  'proof_flow.dag.extract':      dagExtractHandler,
  'proof_flow.editor.reveal':    editorRevealHandler,
  'proof_flow.editor.getCursor': getCursorHandler,
};
```

| Rule ID | Level | Description |
|---------|-------|-------------|
| SVC-1 | MUST | Every effect type in FlowNode MUST have a registered handler |
| SVC-2 | MUST | Handlers MUST return `Patch[]` |
| SVC-3 | MUST NOT | Handlers MUST NOT throw (errors expressed as patches) |
| SVC-4 | MUST NOT | Handlers MUST NOT contain domain logic |
| SVC-5 | SHOULD | `validation.services` SHOULD be `'strict'` |

### 7.2 proof_flow.dag.extract

**This is where `files` gets updated.** The handler returns a `merge` patch at the `files` path, keeping the fileUri as an object key (never a path segment).

```typescript
const dagExtractHandler: EffectHandler = async (type, params, context) => {
  const { fileUri } = params as { fileUri: string };

  // Preserve existing FileState fields for forward-compatibility.
  // When FileState gains new fields in v0.2+, this prevents data loss
  // from shallow merge replacing the entire entry.
  const prev = (context.snapshot.data as any)?.files?.[fileUri]
    ?? { fileUri, dag: null, lastSyncedAt: null };

  try {
    // 1. Lean LSP calls (Host-internal, Core is unaware)
    const diagnostics = await leanClient.getDiagnostics(fileUri);
    const goalStates = await leanClient.getGoalStates(fileUri);

    // 2. Parse into candidate DAG
    const candidate = dagParser.parse(diagnostics, goalStates, fileUri);

    // 3. Zod validation at Host boundary (§7.5)
    const validated = ProofDagSchema.safeParse(candidate);

    if (!validated.success) {
      // Validation failure → null DAG, still update timestamp
      return [{
        op: 'merge',
        path: 'files',
        value: {
          [fileUri]: {
            ...prev,
            dag: null,
            lastSyncedAt: context.requirement.createdAt,
          },
        },
      }];
    }

    // 4. Success → merge validated DAG into files
    return [{
      op: 'merge',
      path: 'files',
      value: {
        [fileUri]: {
          ...prev,
          dag: validated.data,
          lastSyncedAt: context.requirement.createdAt,
        },
      },
    }];

  } catch {
    // LSP error → null DAG (MUST NOT throw per SVC-3)
    return [{
      op: 'merge',
      path: 'files',
      value: {
        [fileUri]: {
          ...prev,
          dag: null,
          lastSyncedAt: context.requirement.createdAt,
        },
      },
    }];
  }
};
```

**Why `merge` at `files` level, not `set` at `files.${fileUri}`:**

- `path: 'files'` is a valid static SemanticPath ✅
- `path: 'files.file:///proof.lean.dag'` would be parsed as 6+ segments ❌
- `merge` preserves existing file entries; only the keyed entry is updated ✅
- The fileUri becomes an object key in the `value`, never a path segment ✅

**Why `context.requirement.createdAt` for timestamp:**

Using the requirement's creation time (already determined before the effect executed) ensures timestamp consistency within the same intent. `Date.now()` inside the handler would create non-deterministic values.

**Why `...prev` spread before new fields (prev-merge pattern):**

Core's `merge` op is **shallow** (Core SPEC v2.0.1 patch). The handler replaces the entire `files[fileUri]` entry. When `FileState` gains fields in v0.2+ (e.g., `attempts`, `lastAttemptAt`), a handler that hard-codes only `{ fileUri, dag, lastSyncedAt }` would silently drop those new fields.

Spreading `prev` preserves any existing fields the handler doesn't own. This is a **data-loading safety net**, not domain logic (SVC-4 compliant) — the handler makes no decisions based on `prev`, it simply avoids data loss.

### 7.3 proof_flow.editor.reveal

```typescript
const editorRevealHandler: EffectHandler = async (type, params, context) => {
  const { fileUri, range } = params as { fileUri: string; range: Range };

  // Fire-and-forget VS Code navigation. No state change.
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(fileUri));
  const editor = await vscode.window.showTextDocument(doc);
  editor.revealRange(toVscodeRange(range), vscode.TextEditorRevealType.InCenter);

  return []; // Empty Patch[] — side-effect only
};
```

### 7.4 proof_flow.editor.getCursor

```typescript
const getCursorHandler: EffectHandler = async (type, params, context) => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return [{ op: 'set', path: 'ui.cursorNodeId', value: null }];
  }
  const pos = editor.selection.active;
  const fileUri = editor.document.uri.toString();
  const dag = context.snapshot.data?.files?.[fileUri]?.dag;
  const nodeId = dag ? findNodeAtPosition(dag, pos.line, pos.character) : null;
  return [{ op: 'set', path: 'ui.cursorNodeId', value: nodeId }];
};
```

### 7.5 Zod Boundary

Zod schemas live in `packages/host/schemas/`. Validation occurs **inside effect handlers**, before patches are returned.

```
Lean LSP Response (unknown)
  → dagParser.parse() → candidate object
  → ProofDagSchema.safeParse(candidate)    ← ZOD VALIDATION POINT
  → success: merge Patch with validated.data
  → failure: merge Patch with dag: null
```

| Rule ID | Level | Description |
|---------|-------|-------------|
| ZOD-1 | MUST | Zod schemas MUST live in `packages/host/schemas/` |
| ZOD-2 | MUST NOT | `packages/schema/` MUST NOT import Zod |
| ZOD-3 | MUST | Every domain object entering Core MUST be Zod-validated first |
| ZOD-4 | MUST | Zod failure MUST produce error `Patch[]`, not throw |

---

## 8. AppConfig Instantiation

The **exact** `AppConfig` wiring ProofFlow as a Manifesto App.

```typescript
import { createApp } from '@manifesto-ai/app';
import { createHost } from '@manifesto-ai/host';
import { compileMelDomain } from '@manifesto-ai/compiler';
import type { AppConfig } from '@manifesto-ai/app';
import { PROOFFLOW_SCHEMA } from '@proof-flow/schema';
import { PROOFFLOW_SERVICES } from '@proof-flow/host';
import { createProofFlowWorldStore } from '@proof-flow/app/worldstore';

export function createProofFlowApp(workspaceUri: string, username: string) {
  const config: AppConfig = {
    // Schema: pre-compiled DomainSchema OR MEL text (App compiles if string)
    schema: PROOFFLOW_SCHEMA,

    // Host: manages compute/apply loop
    host: createHost(),

    // WorldStore: persistence
    worldStore: createProofFlowWorldStore({
      root: `${workspaceUri}/.proof-flow/worlds/${username}`,
      checkpointInterval: 20,
      maxDeltaChain: 50,
    }),

    // Policy: single-actor auto-approve (ADR-003)
    policyService: {
      evaluateProposal: async () => ({
        approved: true,
        scope: { allowedPaths: ['**'] },
        timestamp: Date.now(),
      }),
      deriveExecutionKey: (p) => `proposal:${p.proposalId}`,
    },

    // Effect handlers
    services: PROOFFLOW_SERVICES,

    // Strict: fail if schema effects have no handler
    validation: { services: 'strict' },
  };

  return createApp(config);
  // createApp() calls withPlatformNamespaces() internally (APP-NS-1)
  // → injects $host, $mel with defaults into schema
}
```

| Rule ID | Level | Description |
|---------|-------|-------------|
| APP-1 | MUST | Extension MUST create App via `createApp(config)` |
| APP-2 | MUST | `createApp()` MUST apply `withPlatformNamespaces()` (APP-NS-1) |
| APP-3 | MUST | `app.ready()` MUST be called before any `app.act()` |
| APP-4 | MUST | `app.dispose()` MUST be called in `deactivate` |

---

## 9. VS Code ↔ Manifesto Lifecycle

```typescript
// extension.ts
let app: App;

export async function activate(context: vscode.ExtensionContext) {
  const wsUri = vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? '';
  app = createProofFlowApp(wsUri, resolveUsername());
  await app.ready(); // Schema validated, $mel injected, WorldStore restored

  // ALL events → app.act()
  context.subscriptions.push(
    // Lean recheck → dag_sync
    onLeanRecheckComplete((uri) => app.act('dag_sync', { fileUri: uri })),

    // Editor tab → file_activate
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (e && isLeanFile(e.document))
        app.act('file_activate', { fileUri: e.document.uri.toString() });
    }),

    // Cursor move → cursor_sync (Host resolves nodeId, debounced)
    vscode.window.onDidChangeTextEditorSelection(
      debounce((e) => {
        if (isLeanFile(e.textEditor.document)) {
          const pos = e.selections[0].active;
          const state = app.getState();
          app.act('cursor_sync', {
            resolvedNodeId: resolveNodeAtCursor(state, pos),
          });
        }
      }, 100),
    ),

    // WebView messages → intents
    webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'nodeClick':    app.act('node_select', msg.payload); break;
        case 'togglePanel':  app.act('panel_toggle'); break;
        case 'setLayout':    app.act('layout_set', msg.payload); break;
        case 'setZoom':      app.act('zoom_set', msg.payload); break;
        case 'toggleCollapse': app.act('collapse_toggle'); break;
      }
    }),
  );

  // State → WebView via app.subscribe()
  app.subscribe(
    (s) => ({
      dag: s.snapshot.computed['computed.activeDag'],
      selectedNodeId: s.snapshot.data.ui.selectedNodeId,
      cursorNodeId: s.snapshot.data.ui.cursorNodeId,
      metrics: s.snapshot.computed['computed.summaryMetrics'],
      layout: s.snapshot.data.ui.layout,
      zoom: s.snapshot.data.ui.zoom,
      collapseResolved: s.snapshot.data.ui.collapseResolved,
    }),
    (sel) => webview.postMessage({ type: 'stateUpdate', ...sel }),
  );
}

export async function deactivate() {
  await app?.dispose(); // Drains actions, flushes WorldStore
}
```

| Rule ID | Level | Description |
|---------|-------|-------------|
| LC-1 | MUST | All user/system events MUST dispatch via `app.act()` |
| LC-2 | MUST | State reads MUST go through `app.getState()` or `app.subscribe()` |
| LC-3 | MUST NOT | Extension MUST NOT mutate snapshot directly |
| LC-4 | MUST | WebView receives state via `app.subscribe()` push |

---

## 10. WorldStore Configuration

Per ADR-004 (Git-First Sharing): `{workspaceRoot}/.proof-flow/worlds/{username}/`

Username resolution: `.proof-flow/config.json` → `git config user.name` → OS username → `"local"`

| Policy | Value |
|--------|-------|
| Checkpoint interval | Every 20 Worlds |
| Max delta chain | 50 |
| Compaction threshold | 100 deltas |

---

## 11. Error Taxonomy

ErrorCategory assigned by Host in `dag.extract` handler. Rule-based pattern matching against Lean diagnostics.

| Category | Lean Pattern |
|----------|-------------|
| TYPE_MISMATCH | `type mismatch`, `has type ... expected` |
| UNKNOWN_IDENTIFIER | `unknown identifier`, `unknown constant` |
| TACTIC_FAILED | `tactic '...' failed` |
| UNSOLVED_GOALS | `unsolved goals` |
| TIMEOUT | `(deterministic) timeout` |
| KERNEL_ERROR | `kernel type error` |
| SYNTAX_ERROR | `expected ...`, `unexpected token` |
| OTHER | Fallback |

| Rule ID | Level | Description |
|---------|-------|-------------|
| ERR-1 | MUST | Classification MUST be rule-based (Host responsibility) |
| ERR-2 | MUST | Unrecognized diagnostics MUST be `OTHER` |
| ERR-3 | MUST NOT | Classification MUST NOT use ML/LLM |

---

## 12. Forbidden Patterns

### 12.1 Direct State Mutation (FORBID-1)

```typescript
// ❌ snapshot.data.ui.panelVisible = true;
// ✅ app.act('panel_toggle');
```

### 12.2 State Outside Snapshot (FORBID-2)

```typescript
// ❌ const [dag, setDag] = useState(null);
// ❌ const store = create((set) => ({ dag: null }));
// ✅ All state in Snapshot.data, read via app.getState()
```

### 12.3 IO in Schema Package (FORBID-3)

```typescript
// ❌ import { leanClient } from '../host/lean/client'; // in schema/
// ✅ Effects are declarations: effect proof_flow.dag.extract(...)
```

### 12.4 Domain Logic in Handlers (FORBID-4)

```typescript
// ❌ if (dag.metrics.errorCount > 10) patches.push({ op:'set', path:'ui.showWarning', value:true });
// ✅ Handler returns raw data. Domain decisions live in FlowNode or ComputedSpec.
```

### 12.5 Custom Persistence (FORBID-5)

```typescript
// ❌ fs.writeFileSync('.proof-flow/history.json', data);
// ✅ WorldStore handles all persistence via AppConfig.worldStore
```

### 12.6 Bypassing app.act() (FORBID-6)

```typescript
// ❌ host.dispatch(intent);
// ❌ core.compute(schema, snapshot, intent, context);
// ✅ app.act('dag_sync', { fileUri });
```

### 12.7 Custom Event Systems (FORBID-7)

```typescript
// ❌ const emitter = new EventEmitter(); emitter.on('dagUpdated', ...);
// ✅ app.subscribe(selector, listener);
```

### 12.8 fileUri as Path Segment (FORBID-8)

```typescript
// ❌ { op: 'set', path: `files.${fileUri}.dag`, value: dag }
//    → 'files.file:///proof.lean.dag' parsed as 6+ segments → BROKEN
// ✅ { op: 'merge', path: 'files', value: { [fileUri]: fileState } }
//    → 'files' is valid static path, fileUri is object key
```

### 12.9 Effect Without Guard (FORBID-9)

```
// ❌ MEL: action foo(x: string) { effect bar({ x: x }) }
//    → re-entry would re-declare effect infinitely
// ✅ MEL: action foo(x: string) { onceIntent { effect bar({ x: x }) } }
//    → guard prevents re-declaration
```

### 12.10 Hand-Written Core IR (FORBID-10)

```typescript
// ❌ Manually constructing FlowNode trees in .ts files
//    → Error-prone (wrong ExprNode kinds, missing guards, path issues)
// ✅ Write MEL source → compileMelDomain() → generated .ts
//    → Compiler enforces guard rules, path correctness, IR validity
```

---

## 13. Invariants

### 13.1 Manifesto Contract

| ID | Invariant | Source |
|----|-----------|--------|
| INV-1 | All transitions via `app.act()` → Proposal → World | App SPEC §6 |
| INV-2 | Every `app.act()` produces one World (auto-approve) | ADR-003 |
| INV-3 | Effects are declarations, not executions | Core SPEC §3.1 |
| INV-4 | Handlers return `Patch[]`, never throw | Host Contract §7 |
| INV-5 | Snapshot is immutable | Core SPEC §13.3 |
| INV-6 | All flows are re-entrant (via `onceIntent`) | Host Contract §6.3, MEL §4.7 |
| INV-7 | No suspended execution context | Core SPEC §3.4 |
| INV-8 | `$mel` excluded from World hash | WORLD-HASH-4b |
| INV-9 | App injects `$mel` namespace on startup | APP-NS-1 |

### 13.2 ProofFlow Domain

| ID | Invariant | Enforcement |
|----|-----------|-------------|
| INV-10 | DAG is acyclic | Zod `.refine()` in Host |
| INV-11 | All node refs valid | Zod `.refine()` in Host |
| INV-12 | Host→Core data Zod-validated | Handler impl |
| INV-13 | `files` updated only via Host merge patches | MEL-ACTION-3 |
| INV-14 | fileUri never appears as SemanticPath segment | FORBID-8 |

### 13.3 Package Boundaries

| ID | Invariant | Enforcement |
|----|-----------|-------------|
| INV-15 | `schema` has zero IO imports | PKG-1, lint |
| INV-16 | `schema` has no Zod | PKG-2, lint |
| INV-17 | No domain logic in handlers | FORBID-4, review |
| INV-18 | No state outside Snapshot | FORBID-2, arch tests |
| INV-19 | Domain authored in MEL, not hand-written IR | FORBID-10 |

---

## 14. Compliance

### 14.1 ProofFlow v0.1 Checklist

**MEL Source (§5):**
- [ ] `domain.mel` compiles without errors via `compileMelDomain()`
- [ ] All effects inside `onceIntent` or equivalent guard (FDR-MEL-020)
- [ ] All patches inside `when`, `once`, or `onceIntent` guards (FDR-MEL-020)
- [ ] No `$`-prefixed identifiers in domain code (FDR-MEL-045)
- [ ] No inline object types in state fields (named types only)
- [ ] No `T?` / `T[]` / `any` type syntax (use `T | null` / `Array<T>` / named types)
- [ ] No top-level effect declarations (effects inside action bodies only)
- [ ] Effect params use brace syntax: `effect name({ key: val })`
- [ ] Actions with preconditions use `available when` (MEL-ACTION-5)

**DomainSchema (§6):**
- [ ] Generated `PROOFFLOW_SCHEMA` passes `Core.validate()`
- [ ] ComputedSpec uses `fields` wrapper with `computed.*` key prefix
- [ ] `at()` ExprNode for all dynamic Record lookups
- [ ] No `undefined` literals (null only)

**Effect Handlers (§7):**
- [ ] All handlers registered in `PROOFFLOW_SERVICES`
- [ ] `dag.extract` uses `merge` at `files` path (never `files.${uri}.*`)
- [ ] All return `Patch[]`, never throw
- [ ] Zod validation inside handlers
- [ ] No domain logic in handlers
- [ ] Timestamps from `requirement.createdAt`

**AppConfig (§8):**
- [ ] `createApp(config)` with all required fields
- [ ] `validation.services: 'strict'`
- [ ] Auto-approve PolicyService
- [ ] App applies `withPlatformNamespaces()` (APP-NS-1)

**Lifecycle (§9):**
- [ ] `activate` → `app.ready()` before `app.act()`
- [ ] `deactivate` → `app.dispose()`
- [ ] All events → `app.act()`
- [ ] State reads via `app.subscribe()`

**Forbidden Patterns (§12):**
- [ ] FORBID-1 through FORBID-10 verified

**Package Structure (§4):**
- [ ] PKG-1 through PKG-4 verified

### 14.2 Manifesto Compliance

Minimal Compliance (App SPEC v2.0.0 §20.1):
- [ ] App interface (§6)
- [ ] Lifecycle state machine (§7)
- [ ] HostExecutor (§8)
- [ ] WorldStore core ops (§9)
- [ ] Layer boundaries (§4)
- [ ] Platform namespace support (App SPEC v2.1.0 patch)
- [ ] `$mel` hash exclusion (World SPEC v2.0.3 patch)

---

## 15. Extension Points

### 15.1 v0.2: Attempt History

New MEL actions: `attempt.record` (effect + history/pattern patches), `history.clear`. StateSpec: expand `history.files`. New effect: `proof_flow.attempt.detect`.

### 15.2 v0.3: Pattern Analysis

New computed: `nodeHeatmap`, `patternSuggestions`. New action: `patterns.reset`. PatternEntry gains nullable ADR-005 fields (`dagFingerprint`, `dagClusterId`, `goalSignature`).

### 15.3 v0.4: LLM Integration

New effect: `proof_flow.llm.suggest`. LLM is proposer; Lean typechecker is Authority.

---

## 16. References

| Document | Version | Relevance |
|----------|---------|-----------|
| Core SPEC | v2.0.0 + v2.0.1 patch | DomainSchema, FlowNode, Snapshot, reserved namespaces |
| Host Contract | v2.0.2 | Effect handlers, re-entry, mailbox |
| World Protocol | v2.0.2 + v2.0.3 patch | `$mel` hash exclusion, platform namespaces |
| App SPEC | v2.0.0 + v2.1.0 patch | `$mel` injection, normalizeSnapshot |
| MEL SPEC | v0.5.0 | `onceIntent`, `at()`, guard compilation |
| ProofFlow ADRs | ADR-001~005 | Architecture decisions |
| ProofFlow PRD v2 | — | Product requirements |

---

*End of ProofFlow Domain Specification v0.1.0*
