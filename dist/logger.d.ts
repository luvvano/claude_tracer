import { CallRecord } from './types';
export declare function maskSensitive(value: unknown): unknown;
export declare class SessionLogger {
    readonly sessionId: string;
    private sessionDir;
    private callsFile;
    private callIndex;
    constructor(sessionId: string);
    writeCall(record: Omit<CallRecord, 'call_index'>): void;
    getCallCount(): number;
    getSessionDir(): string;
}
//# sourceMappingURL=logger.d.ts.map