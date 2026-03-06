import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CallRecord, DiffEntry } from './types';

export const TRACER_DIR = path.join(os.homedir(), '.claude-tracer');

export function readCalls(sessionId: string): CallRecord[] {
  try {
    return fs.readFileSync(path.join(TRACER_DIR, 'sessions', sessionId, 'calls.jsonl'), 'utf8')
      .split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as CallRecord);
  } catch { return []; }
}

export function listSessions(): string[] {
  try {
    const dir = path.join(TRACER_DIR, 'sessions');
    return fs.readdirSync(dir)
      .filter(n => { try { return fs.statSync(path.join(dir, n)).isDirectory(); } catch { return false; } })
      .sort().reverse();
  } catch { return []; }
}

export function fmt(n: number): string { return n.toLocaleString('en-US'); }
export function fmtTime(ts: string): string { try { return new Date(ts).toTimeString().slice(0, 8); } catch { return ts; } }
export function fmtDate(ts: string): string { try { return new Date(ts).toISOString().slice(0, 16).replace('T', ' '); } catch { return ts; } }

export function diffLine(e: DiffEntry): string {
  if (e.is_tool_use && e.tool_name) {
    const m = e.content_summary.match(/"(?:path|file_path|command)"\s*:\s*"([^"]+)"/);
    return `  + ${e.role}: [tool_use: ${e.tool_name}${m ? ' → ' + m[1] : ''}]`;
  }
  if (e.content_summary.includes('"type":"tool_result"') || e.content_summary.includes('"type": "tool_result"')) {
    return `  + ${e.role}: [tool_result]`;
  }
  return `  + ${e.role}: "${e.content_summary.replace(/\n/g, ' ').slice(0, 60)}"`;
}
