# claude-tracer

Transparent proxy that logs every Claude Code API call — full `messages[]`, system prompt, token usage, and timing — to JSONL on disk.

Works by intercepting `ANTHROPIC_BASE_URL`. No hooks, no plugins, no patching. Claude Code runs exactly as normal, you just see everything it sends and receives.

## How it works

```
Claude Code → ANTHROPIC_BASE_URL=http://localhost:7749 → claude-tracer → api.anthropic.com
                                                              │
                                              ~/.claude-tracer/sessions/{id}/calls.jsonl
```

Each LLM call logged as one JSON line:
```json
{
  "ts": "2026-03-06T14:30:00.000Z",
  "call_index": 3,
  "model": "claude-opus-4-5",
  "system": "...full system prompt (CLAUDE.md + skills + plugin instructions)...",
  "messages": [
    {"role": "user", "content": "refactor this function"},
    {"role": "assistant", "content": [{"type": "tool_use", "name": "Read", "input": {"path": "src/foo.ts"}}]},
    {"role": "user", "content": [{"type": "tool_result", "content": "...file contents..."}]},
    "..."
  ],
  "usage": {
    "input_tokens": 12400,
    "output_tokens": 287,
    "cache_read_input_tokens": 11200,
    "cache_creation_input_tokens": 0
  },
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

In another terminal (or the same after export):

```bash
export ANTHROPIC_BASE_URL=http://localhost:7749
claude
```

Claude Code works identically. Every API call is now intercepted and logged.

### 3. Watch the logs live

```bash
# Live tail — one JSON line per LLM call
tail -f ~/.claude-tracer/sessions/$(ls -t ~/.claude-tracer/sessions | head -1)/calls.jsonl

# Pretty-print latest call
tail -1 ~/.claude-tracer/sessions/$(ls -t ~/.claude-tracer/sessions | head -1)/calls.jsonl | python3 -m json.tool
```

### 4. Check status

```bash
claude-tracer status
```

```
Status:     running
PID:        12345
Session ID: session_20260306_143012
Port:       7749
Started:    2026-03-06T12:30:12.000Z
Calls:      7
```

### 5. Stop

```bash
claude-tracer stop
```

## CLI Reference

```
claude-tracer start [-f]     Start proxy daemon (use -f to run in foreground)
claude-tracer stop           Stop proxy daemon
claude-tracer status         Show status + call count
claude-tracer --version      Print version
```

## Example: inspect prompt evolution

After a Claude Code session, see how the messages array grew with each turn:

```bash
SESSION=$(ls -t ~/.claude-tracer/sessions | head -1)
CALLS=~/.claude-tracer/sessions/$SESSION/calls.jsonl

# How many LLM calls?
wc -l $CALLS

# Message count per call (how the context window grew)
cat $CALLS | python3 -c "
import sys, json
for i, line in enumerate(sys.stdin):
    d = json.loads(line)
    tools = sum(1 for m in d['messages'] if isinstance(m.get('content'), list)
                for b in m['content'] if isinstance(b, dict) and b.get('type') == 'tool_use')
    print(f\"Call {i}: {len(d['messages'])} messages, {tools} tool calls, {d['usage']['input_tokens'] if d['usage'] else '?'} input tokens, {d['duration_ms']}ms\")
"
```

Output:
```
Call 0: 2 messages, 0 tool calls, 8420 input tokens, 1203ms
Call 1: 4 messages, 1 tool calls, 9105 input tokens, 2841ms
Call 2: 8 messages, 3 tool calls, 10920 input tokens, 3102ms
Call 3: 12 messages, 5 tool calls, 12400 input tokens, 2984ms
```

## Storage layout

```
~/.claude-tracer/
  daemon.pid                          — running proxy state (PID, session ID, port)
  sessions/
    session_YYYYMMDD_HHMMSS/
      calls.jsonl                     — one line per LLM call
```

## Updating

Pull latest changes and rebuild:

```bash
cd claude_tracer
git pull origin master
npm install        # only needed if dependencies changed
npm run build
npm link           # re-link the global binary
```

Verify the update:

```bash
claude-tracer --version
```

If the daemon is running, restart it after updating:

```bash
claude-tracer stop
claude-tracer start
```

## Roadmap

- **Phase 2** (next): `claude-tracer diff` — show what changed between consecutive LLM calls
- **Phase 3**: `claude-tracer watch` — live two-panel TUI (timeline + prompt diff)
