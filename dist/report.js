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
exports.generateReport = generateReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const shared_1 = require("./shared");
// ─── formatting helpers ───────────────────────────────────────────────────────
function fmtDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60_000)
        return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
}
function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// ─── call detail HTML ─────────────────────────────────────────────────────────
function renderCallDetail(call) {
    const lines = [];
    if (call.context_reset) {
        lines.push(`<div class="reset-banner">⚠ CONTEXT RESET — all messages are new</div>`);
    }
    const diffEntries = (call.diff ?? []);
    if (diffEntries.length === 0) {
        lines.push(`<p class="muted">(no diff data — first call or baseline)</p>`);
    }
    else {
        for (const e of diffEntries) {
            let content = '';
            if (e.is_tool_use && e.tool_name) {
                const m = e.content_summary.match(/"(?:path|file_path|command)"\s*:\s*"([^"]+)"/);
                content = `<span class="tool-badge">${escHtml(e.tool_name)}${m ? ' → ' + escHtml(m[1]) : ''}</span>`;
            }
            else if (e.content_summary.includes('"type":"tool_result"') ||
                e.content_summary.includes('"type": "tool_result"')) {
                const lenMatch = e.content_summary.match(/"content"\s*:\s*"([^"]*)"/);
                const chars = lenMatch ? lenMatch[1].length : 0;
                content = `<span class="tool-result-badge">tool_result${chars ? ': ' + chars + ' chars' : ''}</span>`;
            }
            else {
                const summary = escHtml(e.content_summary.replace(/\n/g, ' ').slice(0, 500));
                content = `<span class="msg-content">${summary}${e.content_summary.length > 500 ? '…' : ''}</span>`;
            }
            lines.push(`<div class="diff-entry role-${e.role}"><span class="role-tag">${escHtml(e.role)}</span>${content}</div>`);
        }
    }
    lines.push(`<div class="call-meta">`);
    lines.push(`<span>Model: ${escHtml(call.model)}</span>`);
    lines.push(`<span>Duration: ${fmtDuration(call.duration_ms)}</span>`);
    if (call.usage) {
        lines.push(`<span>In: ${(0, shared_1.fmt)(call.usage.input_tokens ?? 0)} tok</span>`);
        lines.push(`<span>Out: ${(0, shared_1.fmt)(call.usage.output_tokens ?? 0)} tok</span>`);
        if ((call.usage.cache_read_input_tokens ?? 0) > 0) {
            lines.push(`<span>Cache: ${(0, shared_1.fmt)(call.usage.cache_read_input_tokens)} tok</span>`);
        }
    }
    lines.push(`</div>`);
    return lines.join('\n');
}
// ─── call row HTML ────────────────────────────────────────────────────────────
function renderCallRow(call, groupIndex, callIndex) {
    const msgCount = call.messages.length;
    const inputTok = call.usage?.input_tokens ?? 0;
    const resetFlag = call.context_reset ? '<span class="reset-flag" title="Context reset">[R]</span>' : '';
    const detailId = `detail-${groupIndex}-${callIndex}`;
    return `
<div class="call-row" onclick="toggleDetail('${detailId}')">
  <span class="call-index">#${call.call_index}</span>
  <span class="call-time">${(0, shared_1.fmtTime)(call.ts)}</span>
  <span class="call-msgs">${msgCount} msgs</span>
  <span class="call-tokens">${(0, shared_1.fmt)(inputTok)} in</span>
  <span class="call-dur">${fmtDuration(call.duration_ms)}</span>
  ${resetFlag}
  <span class="expand-arrow">▸</span>
</div>
<div class="call-detail" id="${detailId}">
  ${renderCallDetail(call)}
</div>`;
}
// ─── group node HTML (recursive) ─────────────────────────────────────────────
function renderGroup(group, depth, groupIndex) {
    const myIndex = groupIndex.value++;
    const nodeId = `group-${myIndex}`;
    const depthClass = `depth-${Math.min(depth, 5)}`;
    const callsHtml = group.calls
        .map((c, i) => renderCallRow(c, myIndex, i))
        .join('\n');
    const childrenHtml = group.children
        .map(child => renderGroup(child, depth + 1, groupIndex))
        .join('\n');
    return `
<div class="group-node ${depthClass}" id="${nodeId}">
  <div class="group-header" onclick="toggleGroup('${nodeId}')">
    <span class="group-toggle">▶</span>
    <span class="group-label">${escHtml(group.label)}</span>
    <span class="group-stats">
      ${group.stats.callCount} call${group.stats.callCount !== 1 ? 's' : ''} ·
      ${(0, shared_1.fmt)(group.stats.totalInputTokens)} in tok ·
      ${fmtDuration(group.stats.durationMs)}
    </span>
  </div>
  <div class="group-body">
    <div class="calls-list">
      ${callsHtml}
    </div>
    ${childrenHtml}
  </div>
</div>`;
}
// ─── sum tokens recursively ───────────────────────────────────────────────────
function sumTokens(g) {
    return g.stats.totalInputTokens + g.children.reduce((s, c) => s + sumTokens(c), 0);
}
function countGroups(g) {
    return 1 + g.children.reduce((s, c) => s + countGroups(c), 0);
}
// ─── full HTML document ───────────────────────────────────────────────────────
function buildHtml(root, sessionId) {
    const groupIndex = { value: 0 };
    const treeHtml = renderGroup(root, 0, groupIndex);
    const generatedAt = new Date().toISOString();
    const totalTok = sumTokens(root);
    const totalGroups = countGroups(root);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>claude-tracer: ${escHtml(sessionId)}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  background: #0d1117;
  color: #c9d1d9;
  padding: 16px;
  min-height: 100vh;
}

.page-header {
  border-bottom: 1px solid #30363d;
  padding-bottom: 12px;
  margin-bottom: 20px;
}

.page-header h1 {
  font-size: 18px;
  color: #58a6ff;
  font-weight: 600;
}

.page-header .meta {
  color: #8b949e;
  font-size: 12px;
  margin-top: 6px;
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

/* Group nodes */
.group-node {
  border: 1px solid #30363d;
  border-radius: 6px;
  margin: 6px 0;
  overflow: hidden;
}

.group-node.depth-0 { border-color: #1f6feb; }
.group-node.depth-1 { border-color: #388bfd; margin-left: 24px; }
.group-node.depth-2 { border-color: #6e40c9; margin-left: 48px; }
.group-node.depth-3 { border-color: #8957e5; margin-left: 72px; }
.group-node.depth-4 { border-color: #bc8cff; margin-left: 96px; }
.group-node.depth-5 { border-color: #d2a8ff; margin-left: 120px; }

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background: #161b22;
  transition: background 0.15s;
}

.group-node.depth-0 .group-header { background: #0d2045; }
.group-node.depth-1 .group-header { background: #0e1f3d; }
.group-node.depth-2 .group-header { background: #1a0e3d; }
.group-node.depth-3 .group-header { background: #200e3d; }

.group-header:hover { filter: brightness(1.2); }

.group-toggle {
  font-size: 10px;
  color: #8b949e;
  transition: transform 0.15s;
  min-width: 12px;
}

.group-node.open > .group-header .group-toggle {
  transform: rotate(90deg);
}

.group-label {
  color: #e6edf3;
  font-weight: 600;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-stats {
  color: #8b949e;
  font-size: 11px;
  white-space: nowrap;
}

.group-body {
  display: none;
  padding: 8px;
  background: #010409;
}

.group-node.open > .group-body { display: block; }

/* Call rows */
.calls-list { margin-bottom: 4px; }

.call-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.1s;
}

.call-row:hover { background: #161b22; }

.call-index  { color: #8b949e; min-width: 36px; }
.call-time   { color: #3fb950; min-width: 62px; }
.call-msgs   { color: #79c0ff; min-width: 54px; }
.call-tokens { color: #e3b341; min-width: 82px; }
.call-dur    { color: #8b949e; min-width: 54px; }
.reset-flag  { color: #f85149; font-weight: bold; }
.expand-arrow { color: #484f58; margin-left: auto; font-size: 10px; transition: transform 0.15s; }
.call-row.open .expand-arrow { transform: rotate(90deg); }

/* Call detail */
.call-detail {
  display: none;
  padding: 8px 12px;
  border-left: 2px solid #30363d;
  margin: 0 8px 6px 36px;
  background: #0d1117;
  border-radius: 0 4px 4px 0;
}

.call-detail.open { display: block; }

.diff-entry {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px solid #21262d;
}

.diff-entry:last-of-type { border-bottom: none; }

.role-tag {
  min-width: 70px;
  font-weight: 600;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
}

.role-user .role-tag      { background: #0e4429; color: #3fb950; }
.role-assistant .role-tag { background: #0d419d; color: #79c0ff; }

.msg-content       { color: #c9d1d9; word-break: break-word; }
.tool-badge        { background: #161b22; border: 1px solid #30363d; padding: 1px 6px; border-radius: 3px; color: #79c0ff; }
.tool-result-badge { background: #161b22; border: 1px solid #30363d; padding: 1px 6px; border-radius: 3px; color: #8b949e; }

.call-meta {
  display: flex;
  gap: 14px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid #21262d;
  color: #8b949e;
  font-size: 11px;
  flex-wrap: wrap;
}

.reset-banner {
  background: #3d0f0e;
  color: #f85149;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 3px;
  margin-bottom: 6px;
}

.muted { color: #484f58; font-style: italic; }

.footer {
  margin-top: 24px;
  padding-top: 12px;
  border-top: 1px solid #21262d;
  color: #484f58;
  font-size: 11px;
}
</style>
</head>
<body>

<div class="page-header">
  <h1>⚡ claude-tracer: ${escHtml(sessionId)}</h1>
  <div class="meta">
    <span>Generated: ${generatedAt}</span>
    <span>Total input tokens (all groups): ${(0, shared_1.fmt)(totalTok)}</span>
    <span>Conversation groups: ${totalGroups}</span>
  </div>
</div>

<div id="tree">
${treeHtml}
</div>

<div class="footer">
  Generated by claude-tracer · ${escHtml(sessionId)}
</div>

<script>
function toggleGroup(id) {
  const node = document.getElementById(id);
  if (!node) return;
  node.classList.toggle('open');
}

function toggleDetail(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const row = el.previousElementSibling;
  el.classList.toggle('open');
  if (row) row.classList.toggle('open');
}

document.addEventListener('DOMContentLoaded', function() {
  const root = document.querySelector('.group-node.depth-0');
  if (root) root.classList.add('open');
});
</script>
</body>
</html>`;
}
// ─── public API ───────────────────────────────────────────────────────────────
function generateReport(root, sessionId) {
    const html = buildHtml(root, sessionId);
    const outDir = path.join(shared_1.TRACER_DIR, 'sessions', sessionId);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'report.html');
    fs.writeFileSync(outPath, html, 'utf8');
    return outPath;
}
//# sourceMappingURL=report.js.map