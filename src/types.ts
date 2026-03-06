export interface CallRecord {
  ts: string;           // ISO timestamp of request start
  call_index: number;   // 0-based counter within session
  model: string;
  system: string | null;
  messages: unknown[];
  usage: UsageRecord | null;
  duration_ms: number;
}

export interface UsageRecord {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  [key: string]: unknown;
}

export interface DaemonState {
  pid: number;
  sessionId: string;
  port: number;
  startedAt: string;
}
