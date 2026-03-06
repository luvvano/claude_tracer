# Claude Tracer

## What This Is

A Claude Code plugin that provides full observability for every Claude Code session. Tracks tool calls via hooks and captures the full `messages[]` array on each LLM step via a local API proxy, showing live diffs and timing in a second terminal pane.

## Core Value

When you're debugging why Claude Code made a decision, called the wrong tool, or behaved unexpectedly — run `claude-tracer watch` in a side pane, and watch every prompt step live: what messages were sent to the API, what changed since the last call, which tools fired and how long they took, and how many tokens each step cost. Everything is logged to disk for post-mortem review.

## Architecture

```
Claude Code → ANTHROPIC_BASE_URL=http://localhost:7749 → claude-tracer proxy → api.anthropic.com
                                                              │
                                                    logs full request + response
                                                              │
                                               ~/.claude-tracer/sessions/{id}/calls.jsonl

claude-tracer watch  ←  tails calls.jsonl  →  live TUI (second pane)
```

**No hooks. No Claude Code plugin.** Pure proxy — intercepts all API traffic, captures everything:
- Full `messages[]` array (includes tool_use and tool_result blocks — all tool calls visible)
- `system` field — complete system prompt as Claude Code assembled it (CLAUDE.md + skills + plugin instructions)
- `usage` — input/output/cache tokens from final SSE chunk
- `duration_ms` — wall time per LLM call

## Requirements v1.0

- [ ] Node.js proxy server on port 7749 — transparent passthrough to `api.anthropic.com`
- [ ] Handles SSE streaming (Claude Code uses `stream: true`) — passes chunks through unchanged, captures final usage chunk
- [ ] JSONL storage: `~/.claude-tracer/sessions/{session_id}/calls.jsonl` — one line per LLM call
- [ ] Each call logged: `{ts, call_index, model, system, messages[], usage, duration_ms}`
- [ ] Sensitive value masking: keys matching `token|key|password|secret|auth|credential` → `"***"`
- [ ] CLI: `claude-tracer start` / `stop` / `status`
- [ ] TUI: `claude-tracer watch` — live two-panel layout — timeline (left) + detail/diff (right)
- [ ] Prompt diff: what changed in `messages[]` between consecutive LLM calls in a session
- [ ] Token display: input/output/cache tokens per call, running total

## Context

### API request format (what proxy receives from Claude Code)
```json
POST /v1/messages
{
  "model": "claude-opus-4-5",
  "stream": true,
  "system": "...full assembled system prompt (CLAUDE.md + skills + plugin instructions)...",
  "messages": [
    {"role": "user", "content": "write me a function"},
    {"role": "assistant", "content": [{"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]},
    {"role": "user", "content": [{"type": "tool_result", "content": "file1.ts\nfile2.ts"}]},
    ...
  ],
  "max_tokens": 8192
}
```

### Storage layout
```
~/.claude-tracer/
  daemon.pid        — proxy server PID
  sessions/
    session_20260306_143000/
      calls.jsonl   — one line per LLM call: {ts, call_index, model, system, messages, usage, duration_ms}
```

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Proxy-only, no hooks | Proxy gives everything (messages[], system, usage, tool calls) — hooks add complexity for zero gain |
| Node.js for proxy | Fast streams, native SSE handling, single process |
| JSONL storage (no DB) | Simple, tail-able, zero setup, grep-friendly |
| Full system prompt stored every call | Simple for v1; dedup via hash deferred to v2 |
| Port 7749 | Unlikely collision; fixed for simplicity |
| Manual start (two steps) | Explicit — user controls when tracing is active |
| `claude-tracer watch` separate pane | Non-intrusive — Claude Code runs normally, watcher reads logs |
| Session = one daemon run | Simple session boundary; one `claude-tracer start` = one session |

## Constraints

- Hook scripts must exit in <10s (Claude Code timeout)
- Daemon must not block Claude Code if it crashes — hooks check if daemon is alive, skip gracefully
- Must work without ANTHROPIC_BASE_URL if proxy isn't running (degraded mode: hooks only)
- Privacy: mask `token`, `key`, `password`, `secret`, `auth`, `credential` in tool params

---
*Last updated: 2026-03-06 — Initial project setup*
