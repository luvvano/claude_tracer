export interface CallRecord {
    ts: string;
    call_index: number;
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
//# sourceMappingURL=types.d.ts.map