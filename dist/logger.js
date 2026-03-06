"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionLogger = void 0;
exports.maskSensitive = maskSensitive;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const SENSITIVE_KEY_RE = /token|key|password|secret|auth|credential/i;
function maskSensitive(value) {
    if (value === null || value === undefined)
        return value;
    if (Array.isArray(value))
        return value.map(maskSensitive);
    if (typeof value === 'object') {
        const result = {};
        for (const [k, v] of Object.entries(value)) {
            result[k] = SENSITIVE_KEY_RE.test(k) ? '***' : maskSensitive(v);
        }
        return result;
    }
    return value;
}
class SessionLogger {
    sessionId;
    sessionDir;
    callsFile;
    callIndex = 0;
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.sessionDir = path.join(os.homedir(), '.claude-tracer', 'sessions', sessionId);
        this.callsFile = path.join(this.sessionDir, 'calls.jsonl');
        fs.mkdirSync(this.sessionDir, { recursive: true });
    }
    writeCall(record) {
        const full = {
            ...record,
            call_index: this.callIndex++,
            messages: maskSensitive(record.messages),
        };
        fs.appendFileSync(this.callsFile, JSON.stringify(full) + '\n', 'utf8');
    }
    getCallCount() {
        return this.callIndex;
    }
    getSessionDir() {
        return this.sessionDir;
    }
}
exports.SessionLogger = SessionLogger;
//# sourceMappingURL=logger.js.map