# Manifesto 실효성 검증 기록 (2026-02-21)

## 실행한 검증 루프
- `node scripts/vscode-proof-attempt.mjs`
- `node scripts/vscode-lineage-no-ui.mjs`
- `node scripts/vscode-goal-fidelity.mjs` (`pnpm test:spike:goal-fidelity`)

## 수치 요약

- `proof-attempt`
  - `lineageLength`: `2 -> 6` (`+4`)
  - `statusChanged`: `1`
  - `edges`: `+4`
- `lineage-no-ui`
  - `lineageLength`: `2 -> 6` (`+4`)
  - `delta.statusChanged`: `1`
  - `delta.edges`: `4`
- `goal-fidelity` 총합
  - `edges`: `12`
  - `statusChanged`: `0` (샘플별 고정 시점/샘플 편집 스냅샷 기준)

## 증거 파일
- `/Users/eggp/dev/workspace/eggp/manifesto-ai/workspaces/proof-flow/reports/proof-attempt-report.json`
- `/Users/eggp/dev/workspace/eggp/manifesto-ai/workspaces/proof-flow/reports/vscode-lineage-no-ui-report.json`
- `/Users/eggp/dev/workspace/eggp/manifesto-ai/workspaces/proof-flow/reports/goal-fidelity-report.json`

## 판정
- 핵심 인프라(아이덴티티·액션 체인·lineage)는 로컬 실제 증명 시나리오에서 반복적으로 재현 가능.
- UI 유무와 무관하게 `Manifesto` 상태 전이와 월드 계보 기록은 유지됨.

