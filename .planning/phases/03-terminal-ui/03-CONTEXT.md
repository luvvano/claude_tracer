# Phase 3: Terminal UI — Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Build `claude-tracer watch` — a live two-panel TUI that shows the call timeline on the left and prompt diff detail on the right. Opens with an interactive session picker. Updates in real-time as Claude Code makes new API calls.

After this phase: `claude-tracer watch` in one terminal while `ANTHROPIC_BASE_URL=http://localhost:7749 claude` runs in another — you see every LLM call appear live with full diff, tool calls, and token counts.

</domain>

<decisions>
## Implementation Decisions

### TUI Library
- **`blessed`** (npm: `blessed`) — low-level, full control, box/grid layouts, works in any terminal
- NOT `ink` (bad for live-tail streams), NOT raw readline (too much boilerplate)
- TypeScript bindings via `@types/blessed`

### Layout: Vertical Split
```
┌──────────────────────┬─────────────────────────────────┐
│ Timeline             │ Detail / Diff                   │
│ ▶ Call 0  8,420 tok  │  Call 2 — 2 new messages        │
│   Call 1  9,105 tok  │  ──────────────────────────     │
│   Call 2 10,920 tok  │  [+] assistant                  │
│   Call 3 12,400 tok  │      [tool_use: Read → foo.ts]  │
│                      │  [+] user                       │
│                      │      [tool_result: 142 chars]   │
│                      │                                 │
│                      │  Full: 8 msgs (6 old + 2 new)   │
└──────────────────────┴─────────────────────────────────┘
│ session_20260306_143012 │ 4 calls │ 12,400 tok │ 01:23 │
```
- Left panel: ~35% width, scrollable list of calls
- Right panel: ~65% width, scrollable detail for selected call
- Bottom status bar: session ID (truncated), call count, total tokens, elapsed time

### Session Picker (interactive)
- `claude-tracer watch` without args → shows list of sessions sorted newest-first
- User navigates with arrow keys, picks with Enter
- Optionally: `claude-tracer watch <session_id>` skips picker and opens directly

### Diff Display: Colored
- New messages shown in **green**
- Header line: `"Call N — X new messages (Y total)"`
- `context_reset: true` shown as red banner: `"⚠ Context reset — all messages are new"`
- Tool use: `[tool_use: ToolName → target]` on one line
- Tool result: `[tool_result: N chars]` summary
- Content truncated at 300 chars per message

### Live Update: fs.watch
- `fs.watch(callsFile, { persistent: true })` fires on each new JSONL line written
- On change: re-read file, append new calls to timeline list
- Auto-scroll timeline to new call if user was already at the bottom
- If user navigated away from bottom: don't auto-scroll (show indicator "+ N new")

### Navigation
- `↑/↓` or `j/k` — navigate timeline
- `Enter` — select call, show detail
- `Tab` — switch focus between panels
- `g/G` — jump to top/bottom of timeline
- `q` or `Ctrl+C` — quit

### New Call Animation
- New call in timeline briefly highlighted (cyan bg) for 1 second, then normal
- Status bar updates immediately on new call

### Claude's Discretion
- Exact blessed widget types (list vs log vs box for each panel)
- Scrolling implementation details within panels
- Color scheme specifics (beyond green=new, red=reset)
- Exact padding/border styles

</decisions>

<code_context>
## Existing Code to Build On

### Data already available (from Phase 1+2)
- `~/.claude-tracer/sessions/{session_id}/calls.jsonl` — one JSON line per call
- Each line has: `call_index`, `model`, `ts`, `duration_ms`, `diff[]`, `input_token_total`, `context_reset?`, `usage`
- `diff[]` entries have: `role`, `content_summary`, `is_tool_use`, `tool_name`

### CLI entry point
- Add `watch [session_id]` command to `src/cli.ts`
- TUI logic in new file `src/watch.ts`

### Session listing
- `listSessions()` already exists in `src/cli.ts` — can be extracted to shared util
- Sessions sorted newest-first (`.sort().reverse()`)

### Reusable helpers
- `readCalls(sessionId)` — already in cli.ts, reads + parses calls.jsonl
- `fmtTime()`, `fmtDate()`, `fmt()` — formatting helpers in cli.ts
- `diffLine()` — renders one diff entry to string, in cli.ts

### npm packages to add
- `blessed` — TUI framework
- `@types/blessed` — TypeScript types

</code_context>

<specifics>
## File Structure

```
src/
  cli.ts      — add `watch [session_id]` command
  watch.ts    — new: TUI implementation (session picker + main watch view)
  shared.ts   — new: extract shared helpers (readCalls, listSessions, fmtTime etc)
```

## Session Picker Flow
```
claude-tracer watch
→ reads ~/.claude-tracer/sessions/
→ shows list (if >1 session)
→ user picks with arrows + Enter
→ opens main TUI for that session
```

If 0 sessions: "No sessions found. Start claude-tracer and run claude first."
If 1 session: skip picker, open it directly.

## Status Bar Content
```
session_20260306_143012 (truncated to 24 chars) │ 4 calls │ 12,400 tok │ 01:23
```
- Token count from last call's `input_token_total`
- Elapsed = current time − first call's `ts`

</specifics>

<deferred>
## Deferred to v2

- Filter by event type (tools only, user messages only)
- Search/grep within timeline
- Export selected call as markdown
- Split-diff view showing system prompt changes between calls
- Polling fallback if `fs.watch` unsupported (NFS mounts etc.)

</deferred>

---

*Phase: 03-terminal-ui*
*Context gathered: 2026-03-06*
