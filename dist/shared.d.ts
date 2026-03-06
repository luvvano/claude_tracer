import { CallRecord, DiffEntry } from './types';
export declare const TRACER_DIR: string;
export declare function readCalls(sessionId: string): CallRecord[];
export declare function listSessions(): string[];
export declare function fmt(n: number): string;
export declare function fmtTime(ts: string): string;
export declare function fmtDate(ts: string): string;
export declare function diffLine(e: DiffEntry): string;
//# sourceMappingURL=shared.d.ts.map