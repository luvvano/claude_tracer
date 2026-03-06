import * as blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';
import { TRACER_DIR, readCalls, listSessions, fmt, fmtTime, diffLine } from './shared';
import { CallRecord } from './types';

// ─── helpers ──────────────────────────────────────────────────────────────────

function timelineItem(c: CallRecord): string {
  const tok = fmt(c.input_token_total ?? c.usage?.input_tokens ?? 0);
  const dur = (c.duration_ms / 1000).toFixed(1) + 's';
  const reset = c.context_reset ? ' [R]' : '';
  return ` ${String(c.call_index).padStart(3)}  ${fmtTime(c.ts)}  ${tok} tok  ${dur}${reset}`;
}

function renderDetail(c: CallRecord | null): string {
  if (!c) return '{bold}Select a call from the timeline.{/bold}';

  const lines: string[] = [];
  lines.push(`{bold}Call ${c.call_index}{/bold}  ${fmtTime(c.ts)}  ${c.model}`);
  lines.push(`Input: ${fmt(c.input_token_total ?? c.usage?.input_tokens ?? 0)} tok  Output: ${fmt(c.usage?.output_tokens ?? 0)} tok  Duration: ${(c.duration_ms / 1000).toFixed(2)}s`);
  if (c.context_reset) lines.push('{yellow-fg}[CONTEXT RESET]{/yellow-fg}');
  lines.push('');

  const diff = c.diff ?? [];
  if (diff.length === 0) {
    if (c.call_index === 0) {
      const fm = (c.messages as Record<string, unknown>[])[0];
      if (fm) {
        lines.push(`{green-fg}+ ${String(fm['role'])}: "${String(fm['content']).slice(0, 120)}"{/green-fg}`);
      } else {
        lines.push('(first call — no diff data)');
      }
    } else {
      lines.push('(no diff data)');
    }
  } else {
    lines.push(`{bold}Diff (+${diff.length} messages):{/bold}`);
    for (const e of diff) {
      const raw = diffLine(e);
      // colour the diff lines
      if (raw.startsWith('+')) {
        lines.push(`{green-fg}${raw}{/green-fg}`);
      } else if (raw.startsWith('-')) {
        lines.push(`{red-fg}${raw}{/red-fg}`);
      } else {
        lines.push(raw);
      }
    }
  }

  return lines.join('\n');
}

// ─── session picker ────────────────────────────────────────────────────────────

function pickSession(screen: blessed.Widgets.Screen): Promise<string | null> {
  return new Promise((resolve) => {
    const sessions = listSessions();
    if (!sessions.length) {
      resolve(null);
      return;
    }

    const picker = blessed.list({
      top: 'center',
      left: 'center',
      width: '70%',
      height: '60%',
      keys: true,
      vi: true,
      border: 'line',
      label: ' Pick a session (Enter to open, q to quit) ',
      style: {
        selected: { bg: 'blue', bold: true },
        item: { fg: 'white' },
      },
      items: sessions.map(sid => {
        const calls = readCalls(sid);
        const tok = calls[calls.length - 1]?.input_token_total ?? 0;
        return ` ${sid}  ${calls.length} calls  ${fmt(tok)} tok`;
      }),
    });

    screen.append(picker);
    picker.focus();
    screen.render();

    picker.on('select', (_item, index) => {
      screen.remove(picker);
      screen.render();
      resolve(sessions[index]);
    });

    screen.key(['q', 'C-c'], () => {
      screen.destroy();
      process.exit(0);
    });
  });
}

// ─── main TUI ──────────────────────────────────────────────────────────────────

export async function openWatch(sessionId: string): Promise<void> {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'claude-tracer watch',
    fullUnicode: true,
  });

  let calls: CallRecord[] = readCalls(sessionId);

  // Left panel — timeline
  const timeline = blessed.list({
    left: 0,
    top: 0,
    width: '35%',
    height: '100%-3',
    keys: true,
    vi: true,
    border: 'line',
    label: ' Timeline ',
    tags: true,
    style: {
      selected: { bg: 'blue', bold: true },
      item: { fg: 'white' },
    },
    items: calls.length ? calls.map(timelineItem) : ['(no calls yet)'],
  });

  // Right panel — detail
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
      ? renderDetail(calls[0])
      : '{bold}Select a call from the timeline.{/bold}',
  });

  // Status bar
  const status = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line',
    tags: true,
    content: '',
  });

  function updateStatus(): void {
    const total = calls[calls.length - 1]?.input_token_total ?? 0;
    const out = calls.reduce((s, c) => s + (c.usage?.output_tokens ?? 0), 0);
    status.setContent(
      ` {bold}${sessionId}{/bold} | ${calls.length} calls | in: ${fmt(total)} | out: ${fmt(out)} tok | q: quit`
    );
  }

  function selectCall(index: number): void {
    const c = calls[index] ?? null;
    detail.setContent(renderDetail(c));
    detail.scrollTo(0);
    screen.render();
  }

  screen.append(timeline);
  screen.append(detail);
  screen.append(status);

  updateStatus();

  // Navigate timeline
  timeline.on('select item', (_item, index) => {
    selectCall(index);
  });

  // Tab to switch focus between panels
  screen.key(['tab'], () => {
    if (screen.focused === timeline) {
      detail.focus();
    } else {
      timeline.focus();
    }
    screen.render();
  });

  // Initial quit handler (will be overridden below)
  screen.key(['q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  timeline.focus();
  screen.render();

  // ─── live update via fs.watch ─────────────────────────────────────────────
  const callsFile = path.join(TRACER_DIR, 'sessions', sessionId, 'calls.jsonl');
  let pendingNew = 0;

  function isAtBottom(): boolean {
    const sel = (timeline as unknown as { selected: number }).selected ?? 0;
    return sel >= calls.length - 1;
  }

  function setTimelineLabel(label: string): void {
    (timeline as unknown as { setLabel: (s: string) => void }).setLabel(label);
  }

  function addTimelineItem(text: string): void {
    (timeline as unknown as { addItem: (s: string) => void }).addItem(text);
  }

  function highlightRow(index: number): void {
    const item = ` {cyan-fg}${timelineItem(calls[index]).trim()}{/cyan-fg}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (timeline as unknown as any).setItem(index, item);
    screen.render();
    setTimeout(() => {
      if (index < calls.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (timeline as unknown as any).setItem(index, timelineItem(calls[index]));
        screen.render();
      }
    }, 1000);
  }

  let fsWatcher: ReturnType<typeof fs.watch> | null = null;

  function startWatcher(): void {
    try {
      fsWatcher = fs.watch(callsFile, { persistent: true }, () => {
        const newCalls = readCalls(sessionId);
        if (newCalls.length > calls.length) {
          const wasAtBottom = isAtBottom();
          const added = newCalls.slice(calls.length);
          calls.push(...added);

          for (const c of added) {
            addTimelineItem(timelineItem(c));
          }

          updateStatus();

          if (wasAtBottom) {
            const newIdx = calls.length - 1;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (timeline as unknown as any).select(newIdx);
            selectCall(newIdx);
            pendingNew = 0;
            setTimelineLabel(' Timeline ');
          } else {
            pendingNew += added.length;
            setTimelineLabel(` Timeline  +${pendingNew} new `);
          }

          // Cyan highlight for new rows
          for (let i = calls.length - added.length; i < calls.length; i++) {
            highlightRow(i);
          }

          screen.render();
        }
      });
    } catch {
      // File may not exist yet if 0 calls; retry after 2s
      setTimeout(startWatcher, 2000);
    }
  }

  startWatcher();

  // When user navigates, clear pending indicator
  timeline.on('keypress', () => {
    if (isAtBottom() && pendingNew > 0) {
      pendingNew = 0;
      setTimelineLabel(' Timeline ');
      screen.render();
    }
  });

  // Override quit to also close watcher
  screen.unkey('q', () => {});
  screen.unkey('C-c', () => {});
  screen.key(['q', 'C-c'], () => {
    if (fsWatcher) fsWatcher.close();
    screen.destroy();
    process.exit(0);
  });
}

// ─── entry point ──────────────────────────────────────────────────────────────

export function startWatch(sessionId?: string): void {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'claude-tracer',
    fullUnicode: true,
  });

  async function run(): Promise<void> {
    let sid = sessionId;

    if (!sid) {
      const sessions = listSessions();
      if (!sessions.length) {
        screen.destroy();
        console.error('No sessions found. Start the proxy and run some Claude Code commands first.');
        process.exit(1);
      }

      if (sessions.length === 1) {
        sid = sessions[0];
        screen.destroy();
      } else {
        sid = (await pickSession(screen)) ?? undefined;
        if (!sid) {
          screen.destroy();
          process.exit(0);
        }
        screen.destroy();
      }
    } else {
      screen.destroy();
    }

    if (sid) {
      await openWatch(sid);
    }
  }

  run().catch(err => {
    screen.destroy();
    console.error(err);
    process.exit(1);
  });
}
