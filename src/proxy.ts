import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { SessionLogger } from './logger';
import { UsageRecord } from './types';

const PORT = 7749;
const UPSTREAM_HOST = 'api.anthropic.com';
const UPSTREAM_PORT = 443;

function generateSessionId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `session_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function writePidFile(sessionId: string): void {
  const dir = path.join(os.homedir(), '.claude-tracer');
  fs.mkdirSync(dir, { recursive: true });
  const state = { pid: process.pid, sessionId, port: PORT, startedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'daemon.pid'), JSON.stringify(state), 'utf8');
}

function removePidFile(): void {
  try {
    fs.unlinkSync(path.join(os.homedir(), '.claude-tracer', 'daemon.pid'));
  } catch { /* ignore */ }
}

export function startProxy(): void {
  const sessionId = generateSessionId();
  const logger = new SessionLogger(sessionId);
  writePidFile(sessionId);

  const server = http.createServer((req, res) => {
    const startTs = new Date().toISOString();
    const startTime = Date.now();

    const bodyChunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(bodyChunks);
      let parsedBody: Record<string, unknown> = {};
      try { parsedBody = JSON.parse(bodyBuf.toString('utf8')); } catch { /* not JSON */ }

      const forwardHeaders: Record<string, string | string[] | undefined> = { ...req.headers };
      delete forwardHeaders['host'];
      forwardHeaders['host'] = UPSTREAM_HOST;

      const options: https.RequestOptions = {
        hostname: UPSTREAM_HOST,
        port: UPSTREAM_PORT,
        path: req.url,
        method: req.method,
        headers: forwardHeaders as http.OutgoingHttpHeaders,
      };

      const upstreamReq = https.request(options, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);

        const isSSE = (upstreamRes.headers['content-type'] ?? '').includes('text/event-stream');
        let usageData: UsageRecord | null = null;

        upstreamRes.on('data', (chunk: Buffer) => {
          res.write(chunk);

          if (isSSE) {
            const text = chunk.toString('utf8');
            const lines = text.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data) as Record<string, unknown>;
                if (parsed['usage']) {
                  usageData = parsed['usage'] as UsageRecord;
                }
              } catch { /* malformed SSE line */ }
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
