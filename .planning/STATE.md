# State: Claude Tracer

## Current Position

Phase: Starting Phase 1
Status: Project initialized — ready to plan Phase 1
Last activity: 2026-03-06 — GSD project created

## Progress

- [ ] Phase 1: Foundation
- [ ] Phase 2: Proxy & Prompt Capture
- [ ] Phase 3: Terminal UI

## Key Decisions

- Daemon: Node.js, port 7749, handles both event collection and API proxy in one process
- Hook scripts: Python (matches Claude Code plugin pattern, fast startup, no deps)
- Storage: JSONL per session (no DB, grep-friendly, tail-able for TUI)
- Proxy: `ANTHROPIC_BASE_URL=http://localhost:7749` — transparent pass-through + capture
- Sensitive masking: keys matching `token|key|password|secret|auth|credential` → `"***"`
- Plugin install: copy to `~/.claude/plugins/cache/local/claude-tracer/`

## Tech Stack

- Hook scripts: Python 3 (stdlib only — json, sys, urllib.request)
- Daemon: Node.js / TypeScript (http, fs, stream)
- CLI: Node.js with commander
- TUI: blessed or ink (decision deferred to Phase 3 planning)
- Storage: `~/.claude-tracer/sessions/{session_id}/events.jsonl` + `prompts.jsonl`

## Blockers

None.
