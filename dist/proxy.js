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
exports.startProxy = startProxy;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("./logger");
const PORT = 7749;
const UPSTREAM_HOST = 'api.anthropic.com';
const UPSTREAM_PORT = 443;
function generateSessionId() {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `session_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
function writePidFile(sessionId) {
    const dir = path.join(os.homedir(), '.claude-tracer');
    fs.mkdirSync(dir, { recursive: true });
    const state = { pid: process.pid, sessionId, port: PORT, startedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, 'daemon.pid'), JSON.stringify(state), 'utf8');
}
function removePidFile() {
    try {
        fs.unlinkSync(path.join(os.homedir(), '.claude-tracer', 'daemon.pid'));
    }
    catch { /* ignore */ }
}
function startProxy() {
    const sessionId = generateSessionId();
    const logger = new logger_1.SessionLogger(sessionId);
    writePidFile(sessionId);
    const server = http.createServer((req, res) => {
        const startTs = new Date().toISOString();
        const startTime = Date.now();
        const bodyChunks = [];
        req.on('data', (chunk) => bodyChunks.push(chunk));
        req.on('end', () => {
            const bodyBuf = Buffer.concat(bodyChunks);
            let parsedBody = {};
            try {
                parsedBody = JSON.parse(bodyBuf.toString('utf8'));
            }
            catch { /* not JSON */ }
            const forwardHeaders = { ...req.headers };
            delete forwardHeaders['host'];
            forwardHeaders['host'] = UPSTREAM_HOST;
            const options = {
                hostname: UPSTREAM_HOST,
                port: UPSTREAM_PORT,
                path: req.url,
                method: req.method,
                headers: forwardHeaders,
            };
            const upstreamReq = https.request(options, (upstreamRes) => {
                res.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);
                const isSSE = (upstreamRes.headers['content-type'] ?? '').includes('text/event-stream');
                let usageData = null;
                upstreamRes.on('data', (chunk) => {
                    res.write(chunk);
                    if (isSSE) {
                        const text = chunk.toString('utf8');
                        const lines = text.split('\n');
                        for (const line of lines) {
                            if (!line.startsWith('data: '))
                                continue;
                            const data = line.slice(6).trim();
                            if (data === '[DONE]')
                                continue;
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed['usage']) {
                                    usageData = parsed['usage'];
                                }
                            }
                            catch { /* malformed SSE line */ }
                        }
                    }
                });
                upstreamRes.on('end', () => {
                    res.end();
                    const duration_ms = Date.now() - startTime;
                    const model = typeof parsedBody['model'] === 'string' ? parsedBody['model'] : 'unknown';
                    const system = typeof parsedBody['system'] === 'string'
                        ? parsedBody['system']
                        : parsedBody['system'] != null ? JSON.stringify(parsedBody['system']) : null;
                    const messages = Array.isArray(parsedBody['messages']) ? parsedBody['messages'] : [];
                    if (req.url?.includes('/messages') && req.method === 'POST') {
                        logger.writeCall({ ts: startTs, model, system, messages, usage: usageData, duration_ms });
                    }
                });
            });
            upstreamReq.on('error', (err) => {
                console.error('[proxy] upstream error:', err.message);
                if (!res.headersSent) {
                    res.writeHead(502);
                    res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
                }
            });
            upstreamReq.write(bodyBuf);
            upstreamReq.end();
        });
    });
    server.listen(PORT, '127.0.0.1', () => {
        console.log(`claude-tracer proxy listening on http://127.0.0.1:${PORT}`);
        console.log(`Session ID: ${sessionId}`);
        console.log(`Logs: ${logger.getSessionDir()}`);
    });
    process.on('SIGTERM', () => {
        console.log('Shutting down...');
        removePidFile();
        server.close(() => process.exit(0));
    });
    process.on('SIGINT', () => {
        removePidFile();
        server.close(() => process.exit(0));
    });
}
if (require.main === module) {
    startProxy();
}
//# sourceMappingURL=proxy.js.map