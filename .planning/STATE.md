# State: Claude Tracer

## Current Position

Phase: Phase 4 complete
Status: Phase 4 complete — report command fully implemented, ready for verification
Last activity: 2026-03-06 — Phase 4 implemented (call tree, HTML report, CLI integration)

## Progress

- [x] Phase 1: Foundation
- [x] Phase 2: Proxy & Prompt Capture
- [x] Phase 3: Terminal UI
- [x] Phase 4: Session Graph Report

## Key Decisions

- **No hooks** — proxy-only architecture; proxy captures everything from API traffic
- Proxy: `ANTHROPIC_BASE_URL=http://localhost:7749` — transparent SSE passthrough + capture
- Session = one daemon run; ID = `session_YYYYMMDD_HHMMSS`
- Storage: `~/.claude-tracer/sessions/{session_id}/calls.jsonl` — one line per LLM call
- System prompt stored in full every call (simple for v1)
- Sensitive masking: keys matching `token|key|password|secret|auth|credential` → `"***"`
- Manual start: `claude-tracer start` + `ANTHROPIC_BASE_URL=... claude` (two steps)

## Tech Stack

- Proxy + CLI: Node.js / TypeScript
- TUI: blessed or ink (decision deferred to Phase 3 planning)
- Storage: JSONL (no DB, grep-friendly, tail-able)

## Blockers

None.
