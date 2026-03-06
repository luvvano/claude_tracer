# Phase 1: Foundation — Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the proxy daemon: a local HTTP server that intercepts all Claude Code ↔ Anthropic API traffic. After this phase: `claude-tracer start` in one terminal, `ANTHROPIC_BASE_URL=http://localhost:7749 claude` in another → every LLM call is logged to JSONL on disk.

No Claude Code hooks. No plugin manifest. Proxy-only architecture.

</domain>

<decisions>
## Implementation Decisions

### Architecture
- **No hooks at all** — proxy gives us everything: messages[], system prompt, tool calls, usage
- Proxy intercepts `ANTHROPIC_BASE_URL=http://localhost:7749` — transparent passthrough to `api.anthropic.com`
- Streaming responses must pass through unchanged (Claude Code uses SSE streaming)
- Tool calls are visible inside messages[] as `{type: "tool_use"}` and `{type: "tool_result"}` blocks — no separate tracking needed

### Startup
- **Two manual steps**: `claude-tracer start` in terminal A, then `ANTHROPIC_BASE_URL=http://localhost:7749 claude` in terminal B
- No wrapper/launcher in Phase 1
- `claude-tracer stop` kills daemon cleanly

### Session Management
- One session = one `claude-tracer start` invocation
- Session ID = timestamp-based (`session_YYYYMMDD_HHMMSS`) generated at daemon start
- All LLM calls within that daemon run belong to that session

### Storage
- All data written to `~/.claude-tracer/sessions/{session_id}/calls.jsonl`
- Each line = one LLM call: `{ts, call_index, model, system, messages, usage, duration_ms}`
- **System prompt stored in full every time** — simple for v1, no dedup
- Sensitive masking: values of keys matching `token|key|password|secret|auth|credential` → `"***"` in messages content

### What to capture per call
```json
{
  "ts": 1234567890,
  "call_index": 0,
  "model": "claude-opus-4-5",
  "system": "...full system prompt...",
  "messages": [...full messages array...],
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 456,
    "cache_read_input_tokens": 200,
    "cache_creation_input_tokens": 0
  },
  "duration_ms": 3421
}
```

### CLI (Phase 1 scope)
- `claude-tracer start` — starts daemon, prints session ID and port, writes PID to `~/.claude-tracer/daemon.pid`
- `claude-tracer stop` — kills daemon via PID file
- `claude-tracer status` — shows if daemon is running, current session ID, call count so far

### Claude's Discretion
- Node.js HTTP server implementation details (http vs express vs fastify — pick simplest)
- Exact JSONL line format details beyond the schema above
- Error handling strategy when upstream API returns errors

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project

### Established Patterns
- Hookify plugin (installed in this Claude Code instance) uses Python for hooks — NOT relevant here since we're doing proxy, not hooks
- Anthropic API uses SSE streaming: `data: {...}\n\n` chunks, final chunk has `"usage"` field

### Integration Points
- `ANTHROPIC_BASE_URL` env var → Claude Code sends all API requests to this URL instead of `api.anthropic.com`
- Must handle both streaming (`stream: true`) and non-streaming requests
- Must forward all request headers (including `x-api-key`, `anthropic-version`, `anthropic-beta`)

</code_context>

<specifics>
## Specific Ideas

- `~/.claude-tracer/` as storage root — survives across project changes
- daemon.pid at `~/.claude-tracer/daemon.pid`
- Session dirs: `~/.claude-tracer/sessions/session_20260306_143000/calls.jsonl`
- Port 7749 fixed (from PROJECT.md decision)

</specifics>

<deferred>
## Deferred Ideas

- `claude-tracer run` wrapper (one command starts proxy + claude) — noted for v2
- System prompt dedup / hash-based storage — noted for v2
- Hook-based tracking — eliminated entirely (proxy covers it all)
- CLAUDE.md file scanner — eliminated (system prompt captured directly from proxy)

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-03-06*
