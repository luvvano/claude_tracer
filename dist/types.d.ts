export interface DiffEntry {
    index: number;
    role: string;
    content_summary: string;
    is_tool_use: boolean;
    tool_name?: string;
}
export interface CallRecord {
    ts: string;
    call_index: number;
    model: string;
    system: string | null;
    messages: unknown[];
    usage: UsageRecord | null;
    duration_ms: number;
    diff?: DiffEntry[];
    context_reset?: boolean;
    input_token_total?: number;
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
export interface ConversationGroup {
    id: string;
    systemSnippet: string;
    label: string;
    calls: CallRecord[];
    parentCallIndex?: number;
    parentGroupId?: string;
    children: ConversationGroup[];
    stats: ConversationGroupStats;
}
export interface ConversationGroupStats {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    callCount: number;
    firstTs: string;
    lastTs: string;
    durationMs: number;
}
//# sourceMappingURL=types.d.ts.map