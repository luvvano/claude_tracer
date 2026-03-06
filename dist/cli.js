#!/usr/bin/env node
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
const commander_1 = require("commander");
const child_process = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const shared_1 = require("./shared");
const PID_FILE = path.join(shared_1.TRACER_DIR, 'daemon.pid');
const PROXY_SCRIPT = path.join(__dirname, 'proxy.js');
const SEP = '─'.repeat(49);
function readState() {
    try {
        return JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    }
    catch {
        return null;
    }
}
function isRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function countCalls(sessionId) {
    try {
        return fs.readFileSync(path.join(shared_1.TRACER_DIR, 'sessions', sessionId, 'calls.jsonl'), 'utf8')
            .split('\n').filter(l => l.trim()).length;
    }
    catch {
        return 0;
    }
}
const program = new commander_1.Command();
program.name('claude-tracer').description('Transparent proxy for tracing Claude Code API calls').version('0.1.0');
// start
program.command('start').description('Start the proxy daemon on port 7749')
    .option('-f, --foreground', 'Run in foreground')
    .action((opts) => {
    const ex = readState();
    if (ex && isRunning(ex.pid)) {
        console.log(`Already running (PID ${ex.pid}, session: ${ex.sessionId})`);
        process.exit(0);
    }
    if (opts.foreground) {
        require('./proxy').startProxy();
        return;
    }
    const child = child_process.spawn(process.execPath, [PROXY_SCRIPT], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (c) => process.stdout.write(c));
    child.stderr?.on('data', (c) => process.stderr.write(c));
    child.unref();
    setTimeout(() => {
        const s = readState();
        if (s && isRunning(s.pid)) {
            console.log(`\nProxy started. Set: export ANTHROPIC_BASE_URL=http://localhost:7749`);
            process.exit(0);
        }
        else {
            console.error('Proxy failed to start');
            process.exit(1);
        }
    }, 1500);
});
// stop
program.command('stop').description('Stop the proxy daemon').action(() => {
    const s = readState();
    if (!s) {
        console.log('Not running.');
        process.exit(0);
    }
    if (!isRunning(s.pid)) {
        console.log('Not running (stale pid). Cleaning up.');
        try {
            fs.unlinkSync(PID_FILE);
        }
        catch { }
        process.exit(0);
    }
    try {
        process.kill(s.pid, 'SIGTERM');
        console.log(`Stopped PID ${s.pid} (session: ${s.sessionId})`);
        setTimeout(() => { try {
            fs.unlinkSync(PID_FILE);
        }
        catch { } process.exit(0); }, 500);
    }
    catch (e) {
        console.error('Failed:', e.message);
        process.exit(1);
    }
});
// status
program.command('status').description('Show proxy daemon status').action(() => {
    const s = readState();
    if (!s || !isRunning(s.pid)) {
        console.log('Status: stopped');
        process.exit(0);
    }
    console.log(`Status:     running\nPID:        ${s.pid}\nSession ID: ${s.sessionId}\nPort:       ${s.port}\nStarted:    ${s.startedAt}\nCalls:      ${countCalls(s.sessionId)}\n\nTo use: export ANTHROPIC_BASE_URL=http://localhost:${s.port}`);
    process.exit(0);
});
// show
program.command('show [session_id]').description('List sessions or show call timeline').action((sessionId) => {
    if (!sessionId) {
        const sessions = (0, shared_1.listSessions)();
        if (!sessions.length) {
            console.log('No sessions found.');
            process.exit(0);
        }
        for (const sid of sessions) {
            const calls = (0, shared_1.readCalls)(sid);
            const last = calls[calls.length - 1];
            const total = last?.input_token_total ?? calls.reduce((s, c) => s + (c.usage?.input_tokens ?? 0), 0);
            console.log(`${sid}  ${calls[0]?.ts ? (0, shared_1.fmtDate)(calls[0].ts) : '(unknown)'}  ${calls.length} calls  ${(0, shared_1.fmt)(total)} tokens`);
        }
        process.exit(0);
    }
    const calls = (0, shared_1.readCalls)(sessionId);
    if (!calls.length) {
        console.error(`No calls found for session: ${sessionId}`);
        process.exit(1);
    }
    console.log(`Session: ${sessionId}`);
    console.log(SEP);
    let outTok = 0;
    for (const c of calls) {
        const inp = c.usage?.input_tokens ?? 0;
        const out = c.usage?.output_tokens ?? 0;
        outTok += out;
        const delta = c.call_index > 0 ? `  (+${(0, shared_1.fmt)(inp)})` : '';
        const reset = c.context_reset ? '  [RESET]' : '';
        console.log(`Call ${c.call_index}  ${(0, shared_1.fmtTime)(c.ts)}  ${c.model}  ${(0, shared_1.fmt)(c.input_token_total ?? inp)} tok  ${(c.duration_ms / 1000).toFixed(1)}s${delta}${reset}`);
        if (c.diff && c.diff.length > 0) {
            for (const e of c.diff)
                console.log((0, shared_1.diffLine)(e));
        }
        else if (c.call_index === 0) {
            const fm = c.messages[0];
            if (fm)
                console.log(`  + ${fm['role']}: "${String(fm['content']).slice(0, 60)}"`);
        }
    }
    const total = calls[calls.length - 1]?.input_token_total ?? 0;
    console.log(SEP);
    console.log(`Total: ${calls.length} calls | ${(0, shared_1.fmt)(total)} input tokens | ${(0, shared_1.fmt)(outTok)} output tokens`);
    const resets = calls.filter(c => c.context_reset).length;
    if (resets > 0)
        console.log(`Context resets: ${resets}`);
    process.exit(0);
});
// diff
program.command('diff <session_id> <call_index>').description('Show prompt diff for a specific call').action((sessionId, idxStr) => {
    const idx = parseInt(idxStr, 10);
    if (isNaN(idx) || idx < 0) {
        console.error(`Invalid call_index: ${idxStr}`);
        process.exit(1);
    }
    const calls = (0, shared_1.readCalls)(sessionId);
    if (!calls.length) {
        console.error(`No calls found for session: ${sessionId}`);
        process.exit(1);
    }
    const call = calls.find(c => c.call_index === idx);
    if (!call) {
        console.error(`Call index ${idx} not found in session ${sessionId}`);
        process.exit(1);
    }
    const diff = call.diff ?? [];
    const total = call.messages.length;
    const added = diff.length;
    console.log(`Call ${idx} diff (${added} messages added):`);
    console.log(SEP);
    if (!diff.length) {
        console.log('  (no diff — first call or diff data unavailable)');
    }
    else {
        for (const e of diff) {
            console.log(`[+] ${e.role} (index=${e.index})`);
            if (e.is_tool_use && e.tool_name) {
                const m = e.content_summary.match(/"input"\s*:\s*(\{[^}]*\})/);
                console.log(`    content: [tool_use] ${e.tool_name} ${m ? m[1] : ''}`);
            }
            else {
                console.log(`    content: ${e.content_summary.replace(/\\n/g, '\n').slice(0, 200)}${e.content_summary.length > 200 ? '...' : ''}`);
            }
            console.log('');
        }
    }
    console.log(SEP);
    console.log(`Full messages[]: ${total} total (${total - added} carried + ${added} new)`);
    process.exit(0);
});
program.parse(process.argv);
//# sourceMappingURL=cli.js.map