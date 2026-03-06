# claude-tracer

Transparent proxy that logs every Claude Code API call — full `messages[]`, system prompt, token usage, and prompt diffs — to JSONL on disk. Comes with a live terminal UI.

Works by intercepting `ANTHROPIC_BASE_URL`. No hooks, no plugins, no patching. Claude Code runs exactly as normal, you just see everything it sends and receives.

## How it works

```
Claude Code → ANTHROPIC_BASE_URL=http://localhost:7749 → claude-tracer → api.anthropic.com
                                                              │
                                              ~/.claude-tracer/sessions/{id}/calls.jsonl

claude-tracer watch  ←  live two-panel TUI (second terminal)
```

Each LLM call logged as one JSON line:
```json
{
  "ts": "2026-03-06T14:30:00.000Z",
  "call_index": 3,
  "model": "claude-opus-4-5",
  "system": "...full system prompt (CLAUDE.md + skills + plugin instructions)...",
  "messages": [...full messages array...],
  "usage": {
    "input_tokens": 12400,
    "output_tokens": 287,
    "cache_read_input_tokens": 11200,
    "cache_creation_input_tokens": 0
  },
  "diff": [
    {"role": "assistant", "is_tool_use": true, "tool_name": "Read", "content_summary": "..."},
    {"role": "user", "is_tool_use": false, "content_summary": "..."}
  ],
  "input_token_total": 42300,
  "duration_ms": 2841
}
```

Sensitive values (keys matching `token|key|password|secret|auth|credential`) are masked to `"***"` before writing.

## Install

Requires Node.js 18+.

```bash
git clone https://github.com/luvvano/claude_tracer
cd claude_tracer
npm install
npm run build
npm link        # makes `claude-tracer` available globally
```

Verify:
```bash
claude-tracer --version   # → 0.1.0
```

## Usage

### 1. Start the proxy

```bash
claude-tracer start
```

Output:
```
claude-tracer proxy listening on http://127.0.0.1:7749
Session ID: session_20260306_143012
Logs: /home/you/.claude-tracer/sessions/session_20260306_143012

Proxy started. Set: export ANTHROPIC_BASE_URL=http://localhost:7749
```

### 2. Run Claude Code through the proxy

In another terminal:

```bash
export ANTHROPIC_BASE_URL=http://localhost:7749
claude
```

Claude Code works identically. Every API call is now intercepted and logged.

### 3. Watch live in the TUI

Open a second terminal pane while Claude Code is running:

```bash
claude-tracer watch
```

If you have multiple sessions, an interactive picker appears — navigate with `↑↓` and press `Enter` to select. To open a specific session directly:

```bash
claude-tracer watch session_20260306_143012
```

**TUI layout:**
```
┌──────────────────────┬─────────────────────────────────┐
│ Timeline             │ Detail / Diff                   │
│ ▶ Call 0  8,420 tok  │  Call 2 — 2 new messages        │
│   Call 1  9,105 tok  │  ──────────────────────────     │
│   Call 2 10,920 tok  │  [+] assistant                  │
│                      │      [tool_use: Read → foo.ts]  │
│                      │  [+] user                       │
│                      │      [tool_result: 142 chars]   │
└──────────────────────┴─────────────────────────────────┘
│ session_20260306_143012 │ 3 calls │ 10,920 tok │ 00:42 │
```

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Navigate timeline |
| `Enter` | Show detail for selected call |
| `Tab` | Switch focus between panels |
| `g` / `G` | Jump to top / bottom |
| `q` or `Ctrl+C` | Quit |

New calls appear automatically as Claude Code runs. If you've scrolled up, the timeline label shows `+N new`.

### 4. Inspect sessions from the command line

```bash
# List all sessions
claude-tracer show

# Full call timeline for a session
claude-tracer show session_20260306_143012

# Prompt diff for a specific call
claude-tracer diff session_20260306_143012 3
```

**`show` output:**
```
session_20260306_143012  2026-03-06 14:30  7 calls  42,300 tokens
```

**`show <session>` output:**
```
Session: session_20260306_143012
─────────────────────────────────────────────────
Call 0  14:30:12  claude-opus-4-5  8,420 tok  1.2s
  + user: "refactor this function"
Call 1  14:30:15  claude-opus-4-5  9,105 tok  2.8s  (+685)
  + assistant: [tool_use: Read → src/foo.ts]
  + user: [tool_result]
Call 2  14:30:18  claude-opus-4-5  10,920 tok  3.1s  (+1815)
  + assistant: [tool_use: Edit → src/foo.ts]
  + user: [tool_result]
─────────────────────────────────────────────────
Total: 3 calls | 10,920 input tokens | 820 output tokens
```

**`diff <session> <call>` output:**
```
Call 2 diff (2 messages added):
─────────────────────────────────────────────────
[+] assistant (index=3)
    content: [tool_use] Edit {"path":"src/foo.ts"}

[+] user (index=4)
    content: [tool_result: ok]

─────────────────────────────────────────────────
Full messages[]: 5 total (3 carried + 2 new)
```

### 5. Stop

```bash
claude-tracer stop
claude-tracer status
```

## CLI Reference

```
claude-tracer start [-f]              Start proxy daemon on port 7749
claude-tracer stop                    Stop proxy daemon
claude-tracer status                  Show running state, session ID, call count
claude-tracer watch [session_id]      Open live two-panel TUI
claude-tracer show [session_id]       List sessions or show call timeline
claude-tracer diff <session> <call>   Show prompt diff for a specific call
claude-tracer --version               Print version
```

## Context reset detection

If Claude Code clears the context mid-session (`/clear`) or the model truncates the history, the messages array shrinks. claude-tracer detects this automatically:

- `context_reset: true` is set on that call
- `diff[]` contains all current messages (treated as "all new")
- In the TUI: red `⚠ CONTEXT RESET` banner in the detail panel
- In `show <session>`: `[RESET]` flag next to the call

## Storage layout

```
~/.claude-tracer/
  daemon.pid                           — proxy PID, session ID, port
  sessions/
    session_YYYYMMDD_HHMMSS/
      calls.jsonl                      — one line per LLM call
```

## Updating

```bash
cd claude_tracer
git pull origin master
npm install        # only if dependencies changed
npm run build
npm link           # re-link the global binary
claude-tracer --version
```

If the daemon is running, restart it after updating:
```bash
claude-tracer stop && claude-tracer start
```
