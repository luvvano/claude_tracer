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
exports.TRACER_DIR = void 0;
exports.readCalls = readCalls;
exports.listSessions = listSessions;
exports.fmt = fmt;
exports.fmtTime = fmtTime;
exports.fmtDate = fmtDate;
exports.diffLine = diffLine;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
exports.TRACER_DIR = path.join(os.homedir(), '.claude-tracer');
function readCalls(sessionId) {
    try {
        return fs.readFileSync(path.join(exports.TRACER_DIR, 'sessions', sessionId, 'calls.jsonl'), 'utf8')
            .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    }
    catch {
        return [];
    }
}
function listSessions() {
    try {
        const dir = path.join(exports.TRACER_DIR, 'sessions');
        return fs.readdirSync(dir)
            .filter(n => { try {
            return fs.statSync(path.join(dir, n)).isDirectory();
        }
        catch {
            return false;
        } })
            .sort().reverse();
    }
    catch {
        return [];
    }
}
function fmt(n) { return n.toLocaleString('en-US'); }
function fmtTime(ts) { try {
    return new Date(ts).toTimeString().slice(0, 8);
}
catch {
    return ts;
} }
function fmtDate(ts) { try {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
}
catch {
    return ts;
} }
function diffLine(e) {
    if (e.is_tool_use && e.tool_name) {
        const m = e.content_summary.match(/"(?:path|file_path|command)"\s*:\s*"([^"]+)"/);
        return `  + ${e.role}: [tool_use: ${e.tool_name}${m ? ' → ' + m[1] : ''}]`;
    }
    if (e.content_summary.includes('"type":"tool_result"') || e.content_summary.includes('"type": "tool_result"')) {
        return `  + ${e.role}: [tool_result]`;
    }
    return `  + ${e.role}: "${e.content_summary.replace(/\n/g, ' ').slice(0, 60)}"`;
}
//# sourceMappingURL=shared.js.map