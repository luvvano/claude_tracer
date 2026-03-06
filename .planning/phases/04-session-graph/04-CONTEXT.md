# Phase 4: Session Graph Report — Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Build `claude-tracer report [session_id]` — generates an interactive HTML call-tree visualization showing how a Claude Code session's LLM calls branch into subagent conversations. Opens in the browser. If already generated, just re-opens the existing file.

Inspired by Go's `pprof` — a self-contained HTML file with an interactive collapsible tree where each node is an LLM call or subagent conversation.

</domain>

<decisions>
## Core Problem: Subagent Detection from Flat JSONL

The `calls.jsonl` is a flat sequential log of ALL LLM calls through the proxy. Subagent calls are interleaved with parent calls — there are no explicit parent/child IDs in the current schema.

### Detection Algorithm

**Signal 1 — System prompt fingerprint change**
Each unique `system` prompt → a distinct "conversation group". Subagents get task-specific system prompts, visibly different from the main Claude Code system prompt.

**Signal 2 — Fresh messages[] start**
When a new conversation group begins, `messages[]` has length 1 or 2 (fresh context). The parent's messages[] was already deep into a multi-turn exchange.

**Signal 3 — Timing overlap (the key link)**
A parent call at time T₁ has a `tool_use` block → the tool_result comes back at time T₂.
If calls from a new system-prompt group occur between T₁ and T₂ → those are the subagent calls spawned by that tool_use.

```
Parent call at T=5.0 (tool_use: Task → "write a parser")
  Subagent call at T=5.1 (system="write a parser", messages[1])
  Subagent call at T=6.3 (system="write a parser", messages[5])
  Subagent call at T=7.8 (system="write a parser", messages[9])  ← done
Parent call at T=7.9 (tool_result: "done, wrote parser.ts")
```

### Tree Data Structure

```typescript
interface ConversationGroup {
  id: string;                  // hash of system prompt first 200 chars
  systemSnippet: string;       // first 80 chars of system prompt
  calls: CallRecord[];         // all calls in this group, in order
  parentCallIndex?: number;    // call_index of parent's tool_use that spawned this
  parentGroupId?: string;      // which group spawned this
  children: ConversationGroup[]; // subagents spawned from this group
  stats: {
    totalInputTokens: number;
    totalOutputTokens: number;
    firstTs: string;
    lastTs: string;
    durationMs: number;
  };
}
```

### Fallback: Orphan Groups
Groups that can't be matched to a parent by timing (e.g., Claude Code's built-in background tasks) → attached to root as direct children.

## HTML Visualization: pprof-Style

### Layout
- Self-contained HTML (no external CDN deps — everything inlined or vanilla JS)
- Collapsible tree, root at top
- Each node = one ConversationGroup (a "conversation thread")
- Inside each node: expandable list of its individual LLM calls
- Click on a call → slide-open panel showing diff entries + message count + token usage

### Node Display
```
┌─────────────────────────────────────────────────────────┐
│ ▶ [main] session_20260306_143012                        │
│   12 calls · 42,300 tok · 8m 32s                        │
│                                                         │
│   ├─ Call 0  14:30:12  2 msgs  8,420 tok  ▸ [expand]   │
│   ├─ Call 3  14:31:44  6 msgs  9,105 tok  ▸ [expand]   │
│   │                                                     │
│   └─ ▶ [subagent] "write a parser for..."               │
│        3 calls · 8,200 tok · 2m 41s                     │
│        ├─ Call 4  14:31:50  2 msgs  4,100 tok           │
│        └─ Call 6  14:33:25  6 msgs  8,200 tok           │
└─────────────────────────────────────────────────────────┘
```

### Call Expand Panel (click to open)
Shows:
- Diff entries (green for new messages, cyan for tool_use/result)
- Full content_summary for each diff entry (up to 500 chars)
- Model, duration_ms, input/output/cache tokens
- context_reset banner if applicable

### Color Scheme (pprof-inspired)
- Root node: dark blue header
- Subagent nodes: gradient from blue → purple (deeper = more purple)
- Token heat: background tint based on input_token_total (more tokens = warmer)
- Sticky header with session metadata

### Output Location
`~/.claude-tracer/sessions/{session_id}/report.html`

## CLI Command

```
claude-tracer report [session_id]
```

**Behavior:**
1. No session_id → interactive picker (reuse `listSessions()` + prompt, same as `watch`)
2. `report.html` already exists for that session → open directly in browser
3. Not yet generated → generate → open in browser

**Browser open (cross-platform):**
```typescript
import { exec } from 'child_process';
const open = (path: string) => {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  exec(`${cmd} "${path}"`);
};
```

**Force regenerate flag:** `claude-tracer report --regen [session_id]` — regenerates even if report.html exists

## Claude's Discretion
- Exact CSS styling (colors, fonts, transitions) — as long as it looks clean
- Whether to use vanilla JS or a minimal inlined D3 snippet
- Exact handling of edge cases (groups with identical system prompts, very short sessions)
- Animation details for expand/collapse

</decisions>

<code_context>
## Existing Code to Build On

### Data
- `~/.claude-tracer/sessions/{session_id}/calls.jsonl` — existing, has all CallRecord fields
- `CallRecord` type: `{ ts, call_index, model, system, messages, usage, duration_ms, diff, context_reset?, input_token_total? }`
- `DiffEntry` type: `{ index, role, content_summary, is_tool_use, tool_name? }`

### Shared Helpers (src/shared.ts)
- `readCalls(sessionId)` — reads + parses calls.jsonl
- `listSessions()` — sorted newest-first
- `fmt(n)` — number formatting
- `fmtTime(ts)` / `fmtDate(ts)` — date formatting
- `TRACER_DIR` — `~/.claude-tracer`

### CLI Pattern (src/cli.ts)
- Commander.js program with `.command('watch [session_id]')` pattern
- Session picker done interactively (readline or prompt)
- Same pattern for `report [session_id]`

### New Files
- `src/graph.ts` — tree reconstruction algorithm (`buildCallTree`)
- `src/report.ts` — HTML generator (`generateReport`)
- `src/cli.ts` — add `report [session_id] [--regen]` command

</code_context>

<specifics>
## File Structure

```
src/
  graph.ts    — new: ConversationGroup type + buildCallTree(calls) algorithm
  report.ts   — new: generateReport(tree, sessionId) → HTML string
  cli.ts      — add report command

~/.claude-tracer/sessions/{session_id}/
  calls.jsonl    — existing
  report.html    — new: generated by report command
```

## Algorithm Steps (graph.ts)

1. `groupBySytemPrompt(calls)` → `Map<fingerprint, CallRecord[]>`
   - fingerprint = hash of `system.slice(0, 200)` (or first 200 chars directly)
2. `detectParentChild(groups, allCalls)` → set parentGroupId + parentCallIndex per group
   - For each group G with first call at T_start:
     - Find parent call P such that P has tool_use AND P.ts < T_start < nextParentCall.ts
     - Assign G.parentCallIndex = P.call_index, G.parentGroupId = P's group fingerprint
3. `buildTree(groups)` → root ConversationGroup with nested children[]
4. `computeStats(group)` → totalInputTokens, totalOutputTokens, durationMs per group

## HTML Generation (report.ts)

- Single function `generateReport(root: ConversationGroup, sessionId: string): string`
- Returns complete `<!DOCTYPE html>` string
- All CSS inlined in `<style>`
- All JS inlined in `<script>` (collapsible tree logic, ~100 lines vanilla JS)
- No external resources (no CDN, no fetch at open time)
- Writes to `~/.claude-tracer/sessions/{sessionId}/report.html`

</specifics>

<deferred>
## Deferred to v2

- Flame graph view (alternative to tree, time on x-axis)
- Token heatmap per message (which messages burned most tokens)
- Diff between two sessions (regression detection)
- Live-updating report (ws/SSE from daemon)
- Export as JSON for further analysis

</deferred>

---

*Phase: 04-session-graph*
*Context gathered: 2026-03-06*
