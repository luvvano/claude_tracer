import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CallRecord, DiffEntry } from './types';

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

function contentSummary(content: unknown): string {
  if (typeof content === 'string') {
    return content.slice(0, 200);
  }
  return JSON.stringify(content).slice(0, 200);
}

function isToolUseContent(content: unknown): { isToolUse: boolean; toolName?: string } {
  if (Array.isArray(content)) {
    const toolUseBlock = content.find(
      (b: unknown) =>
        typeof b === 'object' && b !== null && (b as Record<string, unknown>)['type'] === 'tool_use'
    );
    if (toolUseBlock) {
      return {
        isToolUse: true,
        toolName: (toolUseBlock as Record<string, unknown>)['name'] as string | undefined,
      };
    }
  }
  if (typeof content === 'object' && content !== null) {
    const c = content as Record<string, unknown>;
    if (c['type'] === 'tool_use') {
      return { isToolUse: true, toolName: c['name'] as string | undefined };
    }
  }
  return { isToolUse: false };
}

function computeDiff(
  previousMessages: unknown[],
  currentMessages: unknown[]
): { diff: DiffEntry[]; contextReset: boolean } {
  // Guard: if messages[] shrank, this is a context reset (/clear or truncation).
  // Treat all current messages as "new" and reset the baseline.
  if (currentMessages.length < previousMessages.length) {
    const diff = currentMessages.map((msg, i) => {
      const m = msg as Record<string, unknown>;
      const role = (m['role'] as string) ?? 'unknown';
      const content = m['content'];
      const { isToolUse, toolName } = isToolUseContent(content);
      return {
        index: i,
        role,
        content_summary: contentSummary(content),
        is_tool_use: isToolUse,
        ...(toolName !== undefined ? { tool_name: toolName } : {}),
      };
    });
    return { diff, contextReset: true };
  }

  // Normal case: messages are append-only.
  const newStart = previousMessages.length;
  const diff: DiffEntry[] = [];

  for (let i = newStart; i < currentMessages.length; i++) {
    const msg = currentMessages[i] as Record<string, unknown>;
    const role = (msg['role'] as string) ?? 'unknown';
    const content = msg['content'];
    const { isToolUse, toolName } = isToolUseContent(content);

    diff.push({
      index: i,
      role,
      content_summary: contentSummary(content),
      is_tool_use: isToolUse,
      ...(toolName !== undefined ? { tool_name: toolName } : {}),
    });
  }

  return { diff, contextReset: false };
}

export class SessionLogger {
  private sessionDir: string;
  private callsFile: string;
  private callIndex = 0;
  private previousMessages: unknown[] = [];
  private inputTokenTotal = 0;

  constructor(public readonly sessionId: string) {
    this.sessionDir = path.join(os.homedir(), '.claude-tracer', 'sessions', sessionId);
    this.callsFile = path.join(this.sessionDir, 'calls.jsonl');
    fs.mkdirSync(this.sessionDir, { recursive: true });
  }

  writeCall(record: Omit<CallRecord, 'call_index'>): void {
    const currentMessages = record.messages as unknown[];
    const maskedMessages = maskSensitive(currentMessages) as unknown[];

    const { diff, contextReset } = computeDiff(this.previousMessages, currentMessages);

    const inputTokens = record.usage?.input_tokens ?? 0;
    this.inputTokenTotal += inputTokens;

    const full: CallRecord = {
      ...record,
      call_index: this.callIndex++,
      messages: maskedMessages,
      diff,
      ...(contextReset ? { context_reset: true } : {}),
      input_token_total: this.inputTokenTotal,
    };

    fs.appendFileSync(this.callsFile, JSON.stringify(full) + '\n', 'utf8');

    this.previousMessages = contextReset ? [] : currentMessages;
  }

  getCallCount(): number {
    return this.callIndex;
  }

  getSessionDir(): string {
    return this.sessionDir;
  }
}
