import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CallRecord } from './types';

const SENSITIVE_KEY_RE = /token|key|password|secret|auth|credential/i;

export function maskSensitive(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = SENSITIVE_KEY_RE.test(k) ? '***' : maskSensitive(v);
    }
    return result;
  }
  return value;
}

export class SessionLogger {
  private sessionDir: string;
  private callsFile: string;
  private callIndex = 0;

  constructor(public readonly sessionId: string) {
    this.sessionDir = path.join(os.homedir(), '.claude-tracer', 'sessions', sessionId);
    this.callsFile = path.join(this.sessionDir, 'calls.jsonl');
    fs.mkdirSync(this.sessionDir, { recursive: true });
  }

  writeCall(record: Omit<CallRecord, 'call_index'>): void {
    const full: CallRecord = {
      ...record,
      call_index: this.callIndex++,
      messages: maskSensitive(record.messages) as unknown[],
    };
    fs.appendFileSync(this.callsFile, JSON.stringify(full) + '\n', 'utf8');
  }

  getCallCount(): number {
    return this.callIndex;
  }

  getSessionDir(): string {
    return this.sessionDir;
  }
}
