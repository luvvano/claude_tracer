# Requirements: Claude Tracer

## v1.0 Requirements

### Plugin & Hooks
- [ ] **PLG-01**: Claude Code plugin installable via copying to `~/.claude/plugins/cache/` with correct `.claude-plugin/plugin.json` manifest
- [ ] **PLG-02**: `PreToolUse` hook fires before every tool call — sends event to daemon via HTTP POST
- [ ] **PLG-03**: `PostToolUse` hook fires after every tool call — sends event with result + duration
- [ ] **PLG-04**: `UserPromptSubmit` hook fires on each user message — logs prompt text + timestamp
- [ ] **PLG-05**: `Stop` hook fires on session end — sends session summary event
- [ ] **PLG-06**: `SessionStart` hook fires at session start — scans CLAUDE.md files in project tree, sends list to daemon
- [ ] **PLG-07**: Hook scripts exit gracefully if daemon is unreachable (no crashes, no delays >500ms)

### Daemon (Event Server + API Proxy)
- [ ] **DMN-01**: Node.js daemon starts via `claude-tracer start`, runs on port 7749, writes PID to `~/.claude-tracer/daemon.pid`
- [ ] **DMN-02**: `/event` POST endpoint — receives hook payloads, appends to `~/.claude-tracer/sessions/{session_id}/events.jsonl`
- [ ] **DMN-03**: `/v1/messages` proxy endpoint — receives Anthropic API requests, extracts `messages[]` + `system` + `model`, forwards to `api.anthropic.com`
- [ ] **DMN-04**: Proxy streams API response back to Claude Code unchanged (no latency added beyond network)
- [ ] **DMN-05**: Proxy captures `usage` from final SSE chunk of streaming response — logs input/output/cache tokens
- [ ] **DMN-06**: Prompt diff computed per session — compare `messages[]` array vs previous call, output unified diff
- [ ] **DMN-07**: All LLM call data appended to `~/.claude-tracer/sessions/{session_id}/prompts.jsonl`
- [ ] **DMN-08**: Daemon stays alive across multiple sessions (one daemon serves all concurrent Claude Code instances)

### Storage
- [ ] **STR-01**: `~/.claude-tracer/sessions/{session_id}/events.jsonl` — each line: `{type, ts, ...payload}`
- [ ] **STR-02**: `~/.claude-tracer/sessions/{session_id}/prompts.jsonl` — each line: `{ts, model, messages, diff, usage}`
- [ ] **STR-03**: Sensitive param values masked (keys matching: `token|key|password|secret|auth|credential` → `"***"`)
- [ ] **STR-04**: Auto-cleanup: sessions older than 7 days deleted on daemon start

### CLI
- [ ] **CLI-01**: `claude-tracer start` — starts daemon if not running, prints port
- [ ] **CLI-02**: `claude-tracer stop` — stops daemon
- [ ] **CLI-03**: `claude-tracer watch [session_id]` — opens live TUI; defaults to latest active session
- [ ] **CLI-04**: `claude-tracer show` — lists recent sessions with: id, project dir, start time, tool count, token total
- [ ] **CLI-05**: `claude-tracer show {session_id}` — shows full event timeline for session (no TUI, plain text)

### Terminal UI (watch mode)
- [ ] **TUI-01**: Two-panel layout: left = event timeline, right = detail panel (prompt diff or tool detail)
- [ ] **TUI-02**: Timeline auto-scrolls as new events arrive (tails JSONL in real-time)
- [ ] **TUI-03**: Each event in timeline shows: icon + type + name + duration + token count (for LLM events)
- [ ] **TUI-04**: Selecting a LLM event in timeline shows prompt diff in right panel (added lines green, removed red)
- [ ] **TUI-05**: Selecting a tool event in timeline shows: tool name, input params, output summary, duration
- [ ] **TUI-06**: Header bar: session ID (truncated), project dir, elapsed time, running token total
- [ ] **TUI-07**: `q` to quit, arrow keys to navigate timeline, `Enter` to select event

### CLAUDE.md Analysis
- [ ] **CLD-01**: On `SessionStart`, scan from project dir upward to home dir — collect all CLAUDE.md paths found
- [ ] **CLD-02**: Read each CLAUDE.md, extract first 3 lines (title/description) for display
- [ ] **CLD-03**: Display loaded CLAUDE.md files in TUI as first "system" event in timeline

## v2 Requirements (Deferred)

- Real-time prompt diff as Claude is generating (streaming partial diffs)
- MCP server that exposes trace data as resources to Claude itself
- Cost estimate per session (token count × model pricing table)
- Filter TUI by event type
- Export session as markdown report
- `ANTHROPIC_BASE_URL` auto-injection via wrapper script (`claude-tracer run`)

## Traceability

| Requirement Group | Phase |
|-------------------|-------|
| PLG-01..07 | Phase 1 |
| DMN-01..08 | Phase 2 |
| STR-01..04 | Phase 1+2 |
| CLI-01..05 | Phase 1+3 |
| TUI-01..07 | Phase 3 |
| CLD-01..03 | Phase 1 |
