"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.openWatch = openWatch;
exports.startWatch = startWatch;
const blessed = __importStar(require("blessed"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const shared_1 = require("./shared");
// ─── helpers ──────────────────────────────────────────────────────────────────
function timelineItem(c) {
    const tok = (0, shared_1.fmt)(c.input_token_total ?? c.usage?.input_tokens ?? 0);
    const dur = (c.duration_ms / 1000).toFixed(1) + 's';
    const reset = c.context_reset ? ' [R]' : '';
    return ` ${String(c.call_index).padStart(3)}  ${(0, shared_1.fmtTime)(c.ts)}  ${tok} tok  ${dur}${reset}`;
}
function renderDetail(c) {
    if (!c)
        return '{bold}Select a call from the timeline.{/bold}';
    const lines = [];
    lines.push(`{bold}Call ${c.call_index}{/bold}  ${(0, shared_1.fmtTime)(c.ts)}  ${c.model}`);
    lines.push(`Input: ${(0, shared_1.fmt)(c.input_token_total ?? c.usage?.input_tokens ?? 0)} tok  Output: ${(0, shared_1.fmt)(c.usage?.output_tokens ?? 0)} tok  Duration: ${(c.duration_ms / 1000).toFixed(2)}s`);
    if (c.context_reset)
        lines.push('{yellow-fg}[CONTEXT RESET]{/yellow-fg}');
    lines.push('');
    const diff = c.diff ?? [];
    if (diff.length === 0) {
        if (c.call_index === 0) {
            const fm = c.messages[0];
            if (fm) {
                lines.push(`{green-fg}+ ${String(fm['role'])}: "${String(fm['content']).slice(0, 120)}"{/green-fg}`);
            }
            else {
                lines.push('(first call — no diff data)');
            }
        }
        else {
            lines.push('(no diff data)');
        }
    }
    else {
        lines.push(`{bold}Diff (+${diff.length} messages):{/bold}`);
        for (const e of diff) {
            const raw = (0, shared_1.diffLine)(e);
            // colour the diff lines
            if (raw.startsWith('+')) {
                lines.push(`{green-fg}${raw}{/green-fg}`);
            }
            else if (raw.startsWith('-')) {
                lines.push(`{red-fg}${raw}{/red-fg}`);
            }
            else {
                lines.push(raw);
            }
        }
    }
    return lines.join('\n');
}
// ─── session picker ────────────────────────────────────────────────────────────
function pickSession(screen) {
    return new Promise((resolve) => {
        const sessions = (0, shared_1.listSessions)();
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
                const calls = (0, shared_1.readCalls)(sid);
                const tok = calls[calls.length - 1]?.input_token_total ?? 0;
                return ` ${sid}  ${calls.length} calls  ${(0, shared_1.fmt)(tok)} tok`;
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
async function openWatch(sessionId) {
    const screen = blessed.screen({
        smartCSR: true,
        title: 'claude-tracer watch',
        fullUnicode: true,
    });
    let calls = (0, shared_1.readCalls)(sessionId);
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
    function updateStatus() {
        const total = calls[calls.length - 1]?.input_token_total ?? 0;
        const out = calls.reduce((s, c) => s + (c.usage?.output_tokens ?? 0), 0);
        status.setContent(` {bold}${sessionId}{/bold} | ${calls.length} calls | in: ${(0, shared_1.fmt)(total)} | out: ${(0, shared_1.fmt)(out)} tok | q: quit`);
    }
    function selectCall(index) {
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
        }
        else {
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
    const callsFile = path.join(shared_1.TRACER_DIR, 'sessions', sessionId, 'calls.jsonl');
    let pendingNew = 0;
    function isAtBottom() {
        const sel = timeline.selected ?? 0;
        return sel >= calls.length - 1;
    }
    function setTimelineLabel(label) {
        timeline.setLabel(label);
    }
    function addTimelineItem(text) {
        timeline.addItem(text);
    }
    function highlightRow(index) {
        const item = ` {cyan-fg}${timelineItem(calls[index]).trim()}{/cyan-fg}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        timeline.setItem(index, item);
        screen.render();
        setTimeout(() => {
            if (index < calls.length) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                timeline.setItem(index, timelineItem(calls[index]));
                screen.render();
            }
        }, 1000);
    }
    let fsWatcher = null;
    function startWatcher() {
        try {
            fsWatcher = fs.watch(callsFile, { persistent: true }, () => {
                const newCalls = (0, shared_1.readCalls)(sessionId);
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
                        timeline.select(newIdx);
                        selectCall(newIdx);
                        pendingNew = 0;
                        setTimelineLabel(' Timeline ');
                    }
                    else {
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
        }
        catch {
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
    screen.unkey('q', () => { });
    screen.unkey('C-c', () => { });
    screen.key(['q', 'C-c'], () => {
        if (fsWatcher)
            fsWatcher.close();
        screen.destroy();
        process.exit(0);
    });
}
// ─── entry point ──────────────────────────────────────────────────────────────
function startWatch(sessionId) {
    const screen = blessed.screen({
        smartCSR: true,
        title: 'claude-tracer',
        fullUnicode: true,
    });
    async function run() {
        let sid = sessionId;
        if (!sid) {
            const sessions = (0, shared_1.listSessions)();
            if (!sessions.length) {
                screen.destroy();
                console.error('No sessions found. Start the proxy and run some Claude Code commands first.');
                process.exit(1);
            }
            if (sessions.length === 1) {
                sid = sessions[0];
                screen.destroy();
            }
            else {
                sid = (await pickSession(screen)) ?? undefined;
                if (!sid) {
                    screen.destroy();
                    process.exit(0);
                }
                screen.destroy();
            }
        }
        else {
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
//# sourceMappingURL=watch.js.map