import * as blessed from 'blessed';
import { listSessions } from './shared';

export function startWatch(sessionId?: string): void {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'claude-tracer',
    fullUnicode: true,
  });

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
    style: {
      selected: { bg: 'blue', bold: true },
      item: { fg: 'white' },
    },
    items: ['(no calls yet)'],
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
    content: '{bold}Select a call from the timeline.{/bold}',
  });

  // Status bar
  const status = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line',
    tags: true,
    content: sessionId
      ? ` {bold}${sessionId}{/bold} | loading…`
      : ' {bold}claude-tracer{/bold} | no session',
  });

  screen.append(timeline);
  screen.append(detail);
  screen.append(status);

  // Quit
  screen.key(['q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  timeline.focus();
  screen.render();
}
