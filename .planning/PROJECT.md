# Claude Tracer

## What This Is

A Claude Code plugin that provides full observability for every Claude Code session. Tracks tool calls via hooks and captures the full `messages[]` array on each LLM step via a local API proxy, showing live diffs and timing in a second terminal pane.

## Core Value

When you're debugging why Claude Code made a decision, called the wrong tool, or behaved unexpectedly — run `claude-tracer watch` in a side pane, and watch every prompt step live: what messages were sent to the API, what changed since the last call, which tools fired and how long they took, and how many tokens each step cost. Everything is logged to disk for post-mortem review.

## Architecture

```
Claude Code session
  ├── Hooks (PreToolUse, PostToolUse, SessionStart, Stop, UserPromptSubmit)
  │     └── POST http://localhost:7749/event  →  Event daemon writes to events.jsonl
  └── ANTHROPIC_BASE_URL=http://localhost:7749
        └── Proxy intercepts API calls → logs messages[], diffs, tokens
              └── Forwards to real Anthropic API

claude-tracer watch  ←  tails events.jsonl + prompts.jsonl  →  live TUI
```

## Requirements v1.0

- [ ] Claude Code plugin (`~/.claude/plugins/`) with hook scripts (Python, stdin/stdout JSON)
- [ ] Hooks: SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop
- [ ] Local HTTP server (Node.js) on port 7749:
  - Event endpoint `/event` — receives hook payloads, writes to JSONL
  - Proxy endpoint `/v1/*` — forwards to Anthropic API, intercepts messages[] + usage
- [ ] JSONL storage at `~/.claude-tracer/` — events.jsonl + prompts.jsonl
- [ ] CLI: `claude-tracer` with subcommands: `start` (daemon), `watch` (TUI), `show` (recent sessions)
- [ ] TUI: live two-panel layout — timeline (left) + detail/diff (right)
- [ ] Prompt diff: show what changed in messages[] between each LLM call
- [ ] Tool call display: name, input params (sensitive masked), duration, status
- [ ] Token display: input/output/cache tokens per LLM call, running total
- [ ] CLAUDE.md scanner: at SessionStart, list which CLAUDE.md files are loaded from project tree

## Context

### Hook payload format (Claude Code)
```json
// PreToolUse stdin
{ "session_id": "...", "tool_name": "Bash", "tool_input": { "command": "ls" } }

// PostToolUse stdin  
{ "session_id": "...", "tool_name": "Bash", "tool_input": {...}, "tool_response": "..." }

// UserPromptSubmit stdin
{ "session_id": "...", "prompt": "..." }
```

### Plugin structure (matches Claude Code marketplace pattern)
```
.claude-plugin/plugin.json   — plugin manifest with hook definitions
hooks/
  pretooluse.py
  posttooluse.py
  sessionstart.py
  userpromptsubmit.py
  stop.py
```

### API proxy approach
- `ANTHROPIC_BASE_URL` set via plugin's SessionStart hook (writes to session env)
- Proxy at `localhost:7749/v1/messages` receives full request body (messages[], model, system)
- Computes diff vs previous call in same session
- Forwards to `api.anthropic.com`, streams response, captures usage from final chunk

### Storage layout
```
~/.claude-tracer/
  daemon.pid        — proxy/event server PID
  sessions/
    {session_id}/
      events.jsonl  — hook events (tools, user prompts, session lifecycle)
      prompts.jsonl — LLM calls (messages[], diffs, tokens)
```

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Node.js daemon for proxy + event server | Single process handles both; streams API responses efficiently |
| Python for hook scripts | Matches Claude Code plugin ecosystem (hookify pattern); no deps, fast startup |
| Hook scripts POST to local daemon | Hooks are per-event; daemon holds session state for diffing |
| JSONL storage (no DB) | Simple, tail-able, zero setup, grep-friendly |
| Port 7749 | Unlikely collision; fixed for simplicity |
| `claude-tracer watch` separate process | Non-intrusive — Claude Code runs normally, watcher reads logs |
| Mask sensitive params | Keys/tokens in tool params masked before logging |

## Constraints

- Hook scripts must exit in <10s (Claude Code timeout)
- Daemon must not block Claude Code if it crashes — hooks check if daemon is alive, skip gracefully
- Must work without ANTHROPIC_BASE_URL if proxy isn't running (degraded mode: hooks only)
- Privacy: mask `token`, `key`, `password`, `secret`, `auth`, `credential` in tool params

---
*Last updated: 2026-03-06 — Initial project setup*
