# Roadmap: Claude Tracer

## Milestone: v1.0 — COMPLETE

**Goal:** Full observability for Claude Code sessions — tool events via hooks, full prompt capture via API proxy, live TUI in a second pane.

## Phases

- [x] **Phase 1: Foundation** — Proxy daemon, JSONL storage, CLI start/stop/status.
- [x] **Phase 2: Proxy & Prompt Capture** — messages[], diffs, token counts, show/diff CLI.
- [x] **Phase 3: Terminal UI** — `claude-tracer watch` live two-panel TUI.

---

## Milestone: v1.1

**Goal:** Session call-tree visualization — HTML report showing parent session + subagents as an interactive tree, like Go's pprof.

## Phases

- [ ] **Phase 4: Session Graph Report** — `claude-tracer report [session_id]` generates an interactive HTML call-tree from calls.jsonl; opens in browser.

---

## Phase Details

### Phase 1: Foundation
**Goal**: Proxy daemon running — intercepts Claude Code API calls, logs full messages[] + usage to JSONL
**Requirements**: DMN-01..08, STR-01..04, CLI-01..02

**Success Criteria**:
1. `claude-tracer start` launches proxy on port 7749, prints session ID
2. `ANTHROPIC_BASE_URL=http://localhost:7749 claude` works — Claude Code behaves identically (proxy is transparent)
3. Making a tool call in Claude Code → `cat ~/.claude-tracer/sessions/*/calls.jsonl` shows the full LLM call with messages[] including the tool_use + tool_result blocks
4. SSE streaming works — no timeout, no corruption, responses arrive at normal speed
5. `usage` field populated (input/output/cache tokens) from final SSE chunk
6. `claude-tracer stop` stops daemon cleanly
7. `claude-tracer status` shows running state + session ID + call count

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
