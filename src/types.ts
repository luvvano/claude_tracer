export interface DiffEntry {
  index: number;           // position in messages array
  role: string;            // "user" | "assistant"
  content_summary: string; // first 200 chars of content (stringified)
  is_tool_use: boolean;    // true if assistant content has type: "tool_use"
  tool_name?: string;      // tool name if is_tool_use
}

export interface CallRecord {
  ts: string;              // ISO timestamp of request start
  call_index: number;      // 0-based counter within session
  model: string;
  system: string | null;
  messages: unknown[];
  usage: UsageRecord | null;
  duration_ms: number;
  diff?: DiffEntry[];           // messages added since previous call (empty for first call)
  context_reset?: boolean;      // true if messages[] shrank (user did /clear or context truncation)
  input_token_total?: number;   // running total of input_tokens only (not output/cache)
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
