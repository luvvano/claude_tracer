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
const shared_1 = require("./shared");
// ─── helpers ────────────────────────────────────────────────────────────────
function elapsedStr(calls) {
    if (!calls.length)
        return '00:00';
    const start = new Date(calls[0].ts).getTime();
    const end = new Date(calls[calls.length - 1].ts).getTime();
    const s = Math.floor((end - start) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}
function timelineItem(c) {
    const tok = (0, shared_1.fmt)(c.input_token_total ?? c.usage?.input_tokens ?? 0);
    const reset = c.context_reset ? ' [R]' : '';
    return ` Call ${c.call_index}  ${(0, shared_1.fmtTime)(c.ts)}  ${tok} tok${reset}`;
}
function renderDetailContent(call) {
    const lines = [];
    if (call.context_reset) {
        lines.push('{red-fg}{bold}⚠  CONTEXT RESET — all messages are new{/bold}{/red-fg}');
        lines.push('');
    }
    const added = call.diff?.length ?? 0;
    const total = call.messages.length;
    lines.push(`{bold}Call ${call.call_index}{/bold}  —  ${added} new message${added !== 1 ? 's' : ''} of ${total} total`);
    lines.push('{bold}' + '─'.repeat(44) + '{/bold}');
    lines.push('');
    const diffEntries = call.diff ?? [];
    if (diffEntries.length === 0) {
        if (call.call_index === 0) {
            const msgs = call.messages;
            if (msgs.length > 0) {
                const fm = msgs[0];
                lines.push(`{green-fg}[+] ${fm['role']}{/green-fg}`);
                const content = String(fm['content'] ?? '').replace(/\n/g, ' ').slice(0, 300);
                lines.push(`    ${content}${content.length >= 300 ? '…' : ''}`);
                lines.push('');
            }
        }
        else {
            lines.push('  (no diff data available)');
        }
    }
    else {
        for (const e of diffEntries) {
            if (e.is_tool_use && e.tool_name) {
                const m = e.content_summary.match(/"(?:path|file_path|command)"\s*:\s*"([^"]+)"/);
                lines.push(`{green-fg}[+] ${e.role}{/green-fg}`);
                lines.push(`    {cyan-fg}[tool_use: ${e.tool_name}${m ? ' → ' + m[1] : ''}]{/cyan-fg}`);
            }
            else if (e.content_summary.includes('"type":"tool_result"') ||
                e.content_summary.includes('"type": "tool_result"')) {
                const lenMatch = e.content_summary.match(/"content"\s*:\s*"([^"]*)"/);
                const chars = lenMatch ? lenMatch[1].length : 0;
                lines.push(`{green-fg}[+] ${e.role}{/green-fg}`);
                lines.push(`    {cyan-fg}[tool_result${chars ? ': ' + chars + ' chars' : ''}]{/cyan-fg}`);
            }
            else {
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
        lines.push(`{bold}Tokens:{/bold}   in=${(0, shared_1.fmt)(call.usage.input_tokens ?? 0)}  out=${(0, shared_1.fmt)(call.usage.output_tokens ?? 0)}  cache_read=${(0, shared_1.fmt)(call.usage.cache_read_input_tokens ?? 0)}`);
    }
    return lines.join('\n');
}
// ─── session picker ──────────────────────────────────────────────────────────
function runSessionPicker(screen, sessions, onSelect) {
    const items = sessions.map(sid => {
        const calls = (0, shared_1.readCalls)(sid);
        const tokens = calls.length ? (calls[calls.length - 1].input_token_total ?? 0) : 0;
        const date = calls.length ? (0, shared_1.fmtDate)(calls[0].ts) : '(unknown)';
        return ` ${sid}  ${date}  ${calls.length} calls  ${(0, shared_1.fmt)(tokens)} tok`;
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
    picker.on('select', (_item, index) => {
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
function openWatch(sessionId) {
    let calls = (0, shared_1.readCalls)(sessionId);
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
    function updateStatus() {
        const count = calls.length;
        const tokens = count ? (calls[count - 1].input_token_total ?? 0) : 0;
        const elapsed = elapsedStr(calls);
        const sid = sessionId.length > 24 ? sessionId.slice(-24) : sessionId;
        status.setContent(` {bold}${sid}{/bold} │ ${count} call${count !== 1 ? 's' : ''} │ ${(0, shared_1.fmt)(tokens)} tok │ ${elapsed}`);
    }
    function selectCall(index) {
        if (!calls.length)
            return;
        const idx = Math.max(0, Math.min(index, calls.length - 1));
        detail.setContent(renderDetailContent(calls[idx]));
        detail.scrollTo(0);
        screen.render();
    }
    timeline.on('select', (_item, index) => {
        selectCall(index);
    });
    // Tab switches focus
    screen.key('tab', () => {
        if (screen.focused === timeline) {
            detail.focus();
        }
        else {
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
function startWatch(sessionId) {
    const sessions = (0, shared_1.listSessions)();
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
//# sourceMappingURL=watch.js.map