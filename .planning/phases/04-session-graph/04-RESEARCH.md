# Phase 4 Research: Session Graph Report

## Type Compatibility

### CallRecord.system
`string | null` — **already defined correctly in types.ts**. Plans handle null via `if (!system) return '__no_system__'`. No array-of-blocks risk here: the logger stores system as `string | null`, never as an Anthropic content-block array. No changes needed.

### CallRecord.messages
`unknown[]` — plans cast correctly with `as Record<string, unknown>[]` and guard with `Array.isArray()`. The `messages` field is masked by `maskSensitive` before storage. Safe to iterate via index-based access or `Array.isArray` checks.

### DiffEntry
**Already exists in `src/types.ts`** — no addition needed. `import { DiffEntry } from './types'` in `graph.ts` and `report.ts` will resolve cleanly.

### ConversationGroup / ConversationGroupStats
**Not yet in types.ts** — plan 04-01 correctly adds them. No conflict with existing types.

---

## Plan 04-01 Issues

1. **No TypeScript type issues found** — `ConversationGroup` type definition is self-consistent.
2. **Root selection logic has a subtle bug**: when there's only one group (no subagents), `rootFp = firstCallFp` and `rootFp = maxCalls fp` are the same; the tie-break works. But if TWO groups have equal call counts and neither is the first-call group, the tie-break `if (groups.get(firstCallFp)!.length >= groups.get(rootFp)!.length)` may compare undefined (if `firstCallFp !== rootFp` and `firstCallFp` group is smaller). Non-fatal but slightly unreliable. Low risk in practice.
3. **Multi-level subagents not supported**: parent lookup only searches `rootCallsSorted` (root group only). If a subagent spawns its own subagent, the nested child won't find a parent. Medium risk depending on use case.
4. **`system` cast**: plan uses `call.system as string | null | undefined` but type is `string | null` — the `| undefined` is superfluous but harmless in TypeScript.

---

## Plan 04-02 Issues

1. **`totalTok` calculation is shallow** — only adds ONE level of children's tokens:
   ```typescript
   const totalTok = root.stats.totalInputTokens + root.children.reduce((s, c) => s + c.stats.totalInputTokens, 0);
   ```
   With nested subagents, grandchildren are excluded. Should recursively sum the full tree.

2. **`groupIndex.value` is mutated during `renderGroup` then used in the header** — order-of-operations: `treeHtml` is generated first (mutating `groupIndex`), then `groupIndex.value` is used as "Groups" count in the header. This is correct since header is built after `treeHtml`. No bug.

3. **`escHtml` on `group.label`** — correctly applied. No XSS risk.

4. **`fmtDuration` not exported from shared.ts** — defined locally in report.ts which is fine, no conflict.

5. **No external dependencies** — pure HTML/CSS/JS, self-contained. Good.

---

## Plan 04-03 Issues

### CRITICAL: Duplicate import conflicts

Plan 04-03 instructs adding these imports to cli.ts:
```typescript
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
```

**All three are already present in cli.ts** (lines 2, 3, 4). Adding them again will cause a TypeScript build error (`Duplicate identifier`).

Plan also instructs adding `import * as readline from 'readline'` — this one is NOT yet imported and DOES need to be added. ✓

### Missing imports for new modules
Plan must add:
```typescript
import { buildCallTree } from './graph';
import { generateReport } from './report';
```
These are correctly listed in the plan. ✓

### `async` action handler
Plan uses `async (sessionId, options)` as the Commander action. Commander v9+ supports async actions but does NOT await them automatically — `process.exit()` calls inside async functions work fine. No issue.

### `countGroups` placement
Plan defines `countGroups` after `program.parse(process.argv)` — this is fine in JS/TS (function hoisting for `function` declarations). ✓

### Path injection in `openBrowser`
```typescript
child_process.exec(`${cmd} "${url}"`)
```
If `filePath` contains spaces or quotes, this will break. Session IDs are typically hex/UUID format so safe in practice. Low risk, but `child_process.execFile` with array args would be safer.

---

## Improvements

### 04-01 Changes Needed
1. **Remove duplicate `| undefined`** from system casts (cosmetic only)
2. **Add recursive parent lookup** — for multi-level trees, search ALL non-child groups for a parent, not just root. Or document as known limitation.
3. **Handle multiple `__no_system__` subagents** — all `system: null` calls collapse into one group. If a session has multiple unrelated null-system calls, they'll be incorrectly merged. Consider using call_index ranges as tie-breaker.

### 04-02 Changes Needed
1. **Fix `totalTok` to recursively sum all groups:**
   ```typescript
   function sumTokens(g: ConversationGroup): number {
     return g.stats.totalInputTokens + g.children.reduce((s, c) => s + sumTokens(c), 0);
   }
   const totalTok = sumTokens(root);
   ```

### 04-03 Changes Needed
1. **Do NOT add `child_process`, `fs`, `path` imports** — they already exist in cli.ts. Only add:
   - `import * as readline from 'readline';`
   - `import { buildCallTree } from './graph';`
   - `import { generateReport } from './report';`
2. **Safer browser open** — use `execFile` or shell-escape the path, but low priority.

---

## Algorithm Validation

**System prompt fingerprinting (first 200 chars):**
- Sound approach for distinguishing main agent vs subagents in Claude Code
- Real Claude Code main prompt is 8,000–15,000 chars; first 200 chars are deterministic (CLAUDE.md header + preamble)
- Subagents receive shorter, task-specific system prompts — different fingerprint guaranteed
- `system: null` edge case handled by `'__no_system__'` sentinel

**Timing-overlap parent detection:**
- Finds the last root call whose `ts ≤ child's first ts` — correct approach
- Assumes calls are logged at REQUEST start time (they are: `ts: string` is set by proxy at request time)
- Edge case: if clock skew exists between calls (unlikely, same machine), ordering could be off — very low risk

**Overall:** Algorithm is sound for the common case (main agent + 1–2 subagents). Multi-level nesting would need recursive parent search.

---

## Risk Assessment

**Low risk:**
- TypeScript types are compatible; `system: string | null` matches plan assumptions
- `DiffEntry` already in types.ts — no addition needed
- HTML template is clean, no XSS, no external deps
- `child_process`/`fs`/`path` already imported in cli.ts

**Medium risk:**
- Duplicate import instructions in plan 04-03 — will cause TypeScript build errors if followed literally without modification
- Shallow `totalTok` calculation in report header (off for nested subagents)
- Multi-level subagent nesting not handled by parent lookup algorithm

**High risk:**
- None identified — the overall approach is solid

---

## Conclusion

Plans are **mostly ready to execute with targeted fixes**. The most important correction is plan 04-03: executor must NOT add `child_process`, `fs`, `path` imports (they already exist) — adding them would break the TypeScript build immediately. The `totalTok` shallow-sum in 04-02 is a minor data accuracy issue. The algorithm in 04-01 is sound for the primary use case (single-level subagent tree). All three plans can be executed sequentially after applying the noted corrections.
