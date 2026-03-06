# Roadmap: Claude Tracer

## Milestone: v1.0

**Goal:** Full observability for Claude Code sessions — tool events via hooks, full prompt capture via API proxy, live TUI in a second pane.

## Phases

- [ ] **Phase 1: Foundation** — Plugin scaffold, hook scripts, daemon skeleton, JSONL storage. Hooks fire and events land on disk.
- [ ] **Phase 2: Proxy & Prompt Capture** — API proxy intercepts Anthropic calls, captures messages[], computes diffs, logs tokens.
- [ ] **Phase 3: Terminal UI** — `claude-tracer watch` live two-panel TUI with event timeline and prompt diff view.

---

## Phase Details

### Phase 1: Foundation
**Goal**: Plugin installs, hooks fire on tool calls, events written to disk
**Requirements**: PLG-01..07, STR-01..04, CLI-01..02, CLI-04..05, CLD-01..03, DMN-01..02

**Success Criteria**:
1. Plugin installed and enabled in Claude Code — hooks appear in `~/.claude/settings.json`
2. `claude-tracer start` launches daemon on port 7749
3. Running `claude` → making a tool call → `cat ~/.claude-tracer/sessions/*/events.jsonl` shows the event
4. UserPromptSubmit, SessionStart, Stop events all appear in JSONL
5. CLAUDE.md files from project tree listed as first event in session
6. Hook scripts exit gracefully with no output if daemon is down

### Phase 2: Proxy & Prompt Capture
**Goal**: Every LLM call logged with full messages[], diff vs prior call, token counts
**Requirements**: DMN-03..08, STR-01..02
**Depends on**: Phase 1

**Success Criteria**:
1. `ANTHROPIC_BASE_URL=http://localhost:7749` → Claude Code works normally (proxy is transparent)
2. `~/.claude-tracer/sessions/{id}/prompts.jsonl` has one line per LLM call
3. Each prompts.jsonl entry contains: `messages[]`, `model`, `usage.input`, `usage.output`, `usage.cache_read`
4. `diff` field in prompts.jsonl shows what changed vs previous call in same session
5. Streaming responses work — no timeout, no corruption
6. Token totals accumulate correctly across multi-turn sessions

### Phase 3: Terminal UI
**Goal**: `claude-tracer watch` opens live TUI showing events and prompt diffs
**Requirements**: TUI-01..07, CLI-03
**Depends on**: Phase 1 (events), Phase 2 (prompts)

**Success Criteria**:
1. `claude-tracer watch` opens two-panel TUI in terminal
2. New events appear in left panel as they arrive (live tail)
3. Arrow keys navigate timeline; Enter shows detail in right panel
4. LLM call detail: prompt diff rendered with green/red lines
5. Tool call detail: tool name, params, output, duration
6. Header shows running token total, session duration
7. `q` quits cleanly
