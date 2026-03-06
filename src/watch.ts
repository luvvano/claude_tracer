import * as blessed from 'blessed';
import * as path from 'path';
import { CallRecord } from './types';
import { TRACER_DIR, readCalls, listSessions, fmt, fmtTime, fmtDate } from './shared';

// ─── helpers ────────────────────────────────────────────────────────────────

function elapsedStr(calls: CallRecord[]): string {
  if (!calls.length) return '00:00';
  const start = new Date(calls[0].ts).getTime();
  const end = new Date(calls[calls.length - 1].ts).getTime();
  const s = Math.floor((end - start) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function timelineItem(c: CallRecord): string {
  const tok = fmt(c.input_token_total ?? c.usage?.input_tokens ?? 0);
  const reset = c.context_reset ? ' [R]' : '';
  return ` Call ${c.call_index}  ${fmtTime(c.ts)}  ${tok} tok${reset}`;
}

function renderDetailContent(call: CallRecord): string {
  const lines: string[] = [];

  if (call.context_reset) {
    lines.push('{red-fg}{bold}⚠  CONTEXT RESET — all messages are new{/bold}{/red-fg}');
    lines.push('');
  }

  const added = call.diff?.length ?? 0;
  const total = (call.messages as unknown[]).length;
  lines.push(`{bold}Call ${call.call_index}{/bold}  —  ${added} new message${added !== 1 ? 's' : ''} of ${total} total`);
  lines.push('{bold}' + '─'.repeat(44) + '{/bold}');
  lines.push('');

  const diffEntries = call.diff ?? [];

  if (diffEntries.length === 0) {
    if (call.call_index === 0) {
      const msgs = call.messages as Record<string, unknown>[];
      if (msgs.length > 0) {
        const fm = msgs[0];
        lines.push(`{green-fg}[+] ${fm['role']}{/green-fg}`);
        const content = String(fm['content'] ?? '').replace(/\n/g, ' ').slice(0, 300);
        lines.push(`    ${content}${content.length >= 300 ? '…' : ''}`);
        lines.push('');
      }
    } else {
      lines.push('  (no diff data available)');
    }
  } else {
    for (const e of diffEntries) {
      if (e.is_tool_use && e.tool_name) {
        const m = e.content_summary.match(/"(?:path|file_path|command)"\s*:\s*"([^"]+)"/);
        lines.push(`{green-fg}[+] ${e.role}{/green-fg}`);
        lines.push(`    {cyan-fg}[tool_use: ${e.tool_name}${m ? ' → ' + m[1] : ''}]{/cyan-fg}`);
      } else if (
        e.content_summary.includes('"type":"tool_result"') ||
        e.content_summary.includes('"type": "tool_result"')
      ) {
        const lenMatch = e.content_summary.match(/"content"\s*:\s*"([^"]*)"/);
        const chars = lenMatch ? lenMatch[1].length : 0;
        lines.push(`{green-fg}[+] ${e.role}{/green-fg}`);
        lines.push(`    {cyan-fg}[tool_result${chars ? ': ' + chars + ' chars' : ''}]{/cyan-fg}`);
      } else {
        lines.push(`{green-fg}[+] ${e.role}{/green-fg}`);
        const summary = e.content_summary.replace(/\n/g, ' ').slice(0, 300);
        lines.push(`    ${summary}${summary.length >= 300 ? '…' : ''}`);
      }
      lines.push('');
    }
  }

  lines.push('');
  lines.push(`{bold}Model:{/bold}    ${call.model}`);
  lines.push(`{bold}Duration:{/bold} ${(call.duration_ms / 1000).toFixed(2)}s`);
  if (call.usage) {
    lines.push(`{bold}Tokens:{/bold}   in=${fmt(call.usage.input_tokens ?? 0)}  out=${fmt(call.usage.output_tokens ?? 0)}  cache_read=${fmt(call.usage.cache_read_input_tokens ?? 0)}`);
  }

  return lines.join('\n');
}

// ─── session picker ──────────────────────────────────────────────────────────

function runSessionPicker(
  screen: blessed.Widgets.Screen,
  sessions: string[],
  onSelect: (sessionId: string) => void
): void {
  const items = sessions.map(sid => {
    const calls = readCalls(sid);
    const tokens = calls.length ? (calls[calls.length - 1].input_token_total ?? 0) : 0;
    const date = calls.length ? fmtDate(calls[0].ts) : '(unknown)';
    return ` ${sid}  ${date}  ${calls.length} calls  ${fmt(tokens)} tok`;
  });

  const boxH = Math.min(sessions.length + 4, 20);

  const picker = blessed.list({
    top: 'center',
    left: 'center',
    width: '80%',
    height: boxH,
    label: ' Select Session  (↑↓ / j k)  Enter=open  q=quit ',
    items,
    keys: true,
    vi: true,
    border: 'line',
    style: {
      selected: { bg: 'blue', bold: true },
      item: { fg: 'white' },
    },
  });

  picker.on('select', (_item: blessed.Widgets.BlessedElement, index: number) => {
    screen.destroy();
    setTimeout(() => onSelect(sessions[index]), 50);
  });

  screen.key(['q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  screen.append(picker);
  picker.focus();
  screen.render();
}

// ─── main watch view ─────────────────────────────────────────────────────────

export function openWatch(sessionId: string): void {
  let calls = readCalls(sessionId);

  const screen = blessed.screen({
    smartCSR: true,
    title: `claude-tracer: ${sessionId}`,
    fullUnicode: true,
  });

  // Left panel
  const timeline = blessed.list({
    left: 0,
    top: 0,
    width: '35%',
    height: '100%-3',
    keys: true,
    vi: true,
    border: 'line',
    label: ' Timeline ',
    style: {
      selected: { bg: 'blue', bold: true },
      item: { fg: 'white' },
    },
    items: calls.length ? calls.map(timelineItem) : ['(no calls yet)'],
  });

  // Right panel
  const detail = blessed.box({
    right: 0,
    top: 0,
    width: '65%',
    height: '100%-3',
    keys: true,
    vi: true,
    scrollable: true,
    alwaysScroll: true,
    border: 'line',
    label: ' Detail ',
    tags: true,
    content: calls.length
      ? renderDetailContent(calls[0])
      : '{bold}No calls yet. Waiting…{/bold}',
  });

  // Status bar
  const status = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line',
    tags: true,
  });

  function updateStatus(): void {
    const count = calls.length;
    const tokens = count ? (calls[count - 1].input_token_total ?? 0) : 0;
    const elapsed = elapsedStr(calls);
    const sid = sessionId.length > 24 ? sessionId.slice(-24) : sessionId;
    status.setContent(` {bold}${sid}{/bold} │ ${count} call${count !== 1 ? 's' : ''} │ ${fmt(tokens)} tok │ ${elapsed}`);
  }

  function selectCall(index: number): void {
    if (!calls.length) return;
    const idx = Math.max(0, Math.min(index, calls.length - 1));
    detail.setContent(renderDetailContent(calls[idx]));
    detail.scrollTo(0);
    screen.render();
  }

  timeline.on('select', (_item: blessed.Widgets.BlessedElement, index: number) => {
    selectCall(index);
  });

  // Tab switches focus
  screen.key('tab', () => {
    if (screen.focused === (timeline as unknown as blessed.Widgets.BlessedElement)) {
      detail.focus();
    } else {
      timeline.focus();
    }
    screen.render();
  });

  // Quit
  screen.key(['q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  screen.append(timeline);
  screen.append(detail);
  screen.append(status);

  updateStatus();

  if (calls.length) {
    timeline.select(0);
    selectCall(0);
  }

  timeline.focus();
  screen.render();
}

// ─── entry point ─────────────────────────────────────────────────────────────

export function startWatch(sessionId?: string): void {
  const sessions = listSessions();

  if (sessions.length === 0) {
    console.error('No sessions found. Run: claude-tracer start && ANTHROPIC_BASE_URL=http://localhost:7749 claude');
    process.exit(1);
  }

  if (sessionId) {
    if (!sessions.includes(sessionId)) {
      console.error(`Session not found: ${sessionId}`);
      console.error('Available:\n' + sessions.join('\n'));
      process.exit(1);
    }
    openWatch(sessionId);
    return;
  }

  if (sessions.length === 1) {
    openWatch(sessions[0]);
    return;
  }

  // Multiple sessions — interactive picker
  const screen = blessed.screen({
    smartCSR: true,
    title: 'claude-tracer — select session',
    fullUnicode: true,
  });

  runSessionPicker(screen, sessions, (selected) => {
    openWatch(selected);
  });
}
