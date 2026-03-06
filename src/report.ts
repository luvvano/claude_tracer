import * as fs from 'fs';
import * as path from 'path';
import { ConversationGroup, CallRecord, DiffEntry } from './types';
import { TRACER_DIR, fmt, fmtTime } from './shared';

// ─── formatting helpers ───────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escJs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

// ─── serialize tree to JSON for JS consumption ────────────────────────────────

interface NodeData {
  id: string;
  label: string;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  children: NodeData[];
  calls: CallData[];
}

interface CallData {
  callIndex: number;
  ts: string;
  msgCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  durationMs: number;
  model: string;
  contextReset: boolean;
  diff: DiffData[];
}

interface DiffData {
  role: string;
  isToolUse: boolean;
  toolName?: string;
  contentSummary: string;
}

function serializeGroup(g: ConversationGroup): NodeData {
  return {
    id: g.id.slice(0, 40),
    label: g.label,
    callCount: g.stats.callCount,
    inputTokens: g.stats.totalInputTokens,
    outputTokens: g.stats.totalOutputTokens,
    durationMs: g.stats.durationMs,
    children: g.children.map(serializeGroup),
    calls: g.calls.map(c => ({
      callIndex: c.call_index,
      ts: c.ts,
      msgCount: (c.messages as unknown[]).length,
      inputTokens: c.usage?.input_tokens ?? 0,
      outputTokens: c.usage?.output_tokens ?? 0,
      cacheTokens: c.usage?.cache_read_input_tokens ?? 0,
      durationMs: c.duration_ms,
      model: c.model,
      contextReset: c.context_reset ?? false,
      diff: ((c.diff ?? []) as DiffEntry[]).map(e => ({
        role: e.role,
        isToolUse: e.is_tool_use,
        toolName: e.tool_name,
        contentSummary: e.content_summary.slice(0, 500),
      })),
    })),
  };
}

function sumTokens(g: ConversationGroup): number {
  return g.stats.totalInputTokens + g.children.reduce((s, c) => s + sumTokens(c), 0);
}

// ─── HTML document ────────────────────────────────────────────────────────────

function buildHtml(root: ConversationGroup, sessionId: string): string {
  const treeData = JSON.stringify(serializeGroup(root));
  const totalTok = sumTokens(root);
  const generatedAt = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>claude-tracer: ${escHtml(sessionId)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  background: #f8f8f8;
  color: #111;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
#header {
  background: #fff;
  border-bottom: 1px solid #ddd;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 20px;
  flex-shrink: 0;
}
#header h1 { font-size: 14px; font-weight: 700; color: #1a6cf5; }
#header .meta { font-size: 11px; color: #888; }
#main { display: flex; flex: 1; overflow: hidden; }
#graph-container {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: #fafafa;
  cursor: grab;
}
#graph-container:active { cursor: grabbing; }
#svg-wrap {
  position: absolute;
  top: 0; left: 0;
  transform-origin: 0 0;
}
svg text { font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; }
.node-box {
  fill: #fff;
  stroke: #555;
  stroke-width: 1.5;
  rx: 4;
  cursor: pointer;
}
.node-box:hover { stroke: #1a6cf5; stroke-width: 2; }
.node-box.selected { stroke: #1a6cf5; stroke-width: 2.5; fill: #eef4ff; }
.node-label { font-size: 12px; font-weight: 700; fill: #111; }
.node-stat  { font-size: 11px; fill: #444; }
.node-pct   { font-size: 10px; fill: #888; }
.edge { fill: none; stroke: #999; stroke-width: 1.5; marker-end: url(#arrow); }
.edge-label { font-size: 10px; fill: #999; }
#detail-panel {
  width: 340px;
  border-left: 1px solid #ddd;
  background: #fff;
  overflow-y: auto;
  flex-shrink: 0;
  display: none;
}
#detail-panel.visible { display: block; }
#detail-header {
  padding: 10px 14px;
  border-bottom: 1px solid #eee;
  font-weight: 700;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
#detail-close { cursor: pointer; color: #aaa; font-size: 16px; line-height: 1; }
#detail-close:hover { color: #333; }
.call-item {
  border-bottom: 1px solid #f0f0f0;
  padding: 8px 14px;
  cursor: pointer;
}
.call-item:hover { background: #f5f8ff; }
.call-item.open { background: #eef4ff; }
.call-row { display: flex; gap: 8px; align-items: center; font-size: 11px; }
.call-idx  { color: #aaa; min-width: 28px; }
.call-time { color: #2a9d3d; min-width: 56px; }
.call-msgs { color: #1a6cf5; min-width: 44px; }
.call-tok  { color: #e67e22; min-width: 72px; }
.call-dur  { color: #aaa; }
.call-reset { color: #e74c3c; font-weight: 700; margin-left: 4px; }
.call-detail { display: none; padding: 6px 0 0 0; }
.call-item.open .call-detail { display: block; }
.diff-line {
  font-size: 11px;
  padding: 2px 0;
  display: flex;
  gap: 6px;
  border-bottom: 1px solid #f5f5f5;
}
.diff-line:last-child { border-bottom: none; }
.diff-role {
  min-width: 64px;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 10px;
}
.diff-user .diff-role { background: #e8f9ed; color: #2a9d3d; }
.diff-assistant .diff-role { background: #eef4ff; color: #1a6cf5; }
.diff-content { color: #444; word-break: break-word; }
.tool-badge { background: #f0f0f0; border: 1px solid #ddd; padding: 1px 5px; border-radius: 3px; color: #1a6cf5; font-size: 10px; }
.tool-result-badge { background: #f0f0f0; border: 1px solid #ddd; padding: 1px 5px; border-radius: 3px; color: #888; font-size: 10px; }
.call-meta { font-size: 10px; color: #aaa; padding-top: 4px; display: flex; gap: 8px; flex-wrap: wrap; }
.reset-banner { background: #fef0ef; color: #e74c3c; font-weight: 600; padding: 3px 6px; border-radius: 3px; font-size: 11px; margin-bottom: 4px; }
#hint { position: absolute; bottom: 10px; left: 10px; font-size: 11px; color: #bbb; pointer-events: none; }
</style>
</head>
<body>

<div id="header">
  <h1>⚡ claude-tracer: ${escHtml(sessionId)}</h1>
  <span class="meta">Generated: ${generatedAt}</span>
  <span class="meta">Total input tokens: ${fmt(totalTok)}</span>
  <span class="meta" id="zoom-label">zoom: 100%</span>
</div>

<div id="main">
  <div id="graph-container">
    <div id="svg-wrap">
      <svg id="graph-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#999"/>
          </marker>
        </defs>
        <g id="edges"></g>
        <g id="nodes"></g>
      </svg>
    </div>
    <div id="hint">scroll to zoom · drag to pan · click node to inspect</div>
  </div>
  <div id="detail-panel">
    <div id="detail-header">
      <span id="detail-title">Calls</span>
      <span id="detail-close">✕</span>
    </div>
    <div id="detail-body"></div>
  </div>
</div>

<script>
const TREE = ${treeData};

// ─── layout ───────────────────────────────────────────────────────────────────

const NODE_W = 180;
const NODE_H = 72;
const H_GAP  = 40;
const V_GAP  = 90;

function subtreeWidth(node) {
  if (!node.children.length) return NODE_W;
  const childrenW = node.children.reduce((s, c) => s + subtreeWidth(c), 0)
    + H_GAP * (node.children.length - 1);
  return Math.max(NODE_W, childrenW);
}

function layout(node, x, y) {
  node._x = x;
  node._y = y;
  if (!node.children.length) return;
  const totalW = node.children.reduce((s, c) => s + subtreeWidth(c), 0)
    + H_GAP * (node.children.length - 1);
  let cx = x - totalW / 2 + subtreeWidth(node.children[0]) / 2;
  for (const child of node.children) {
    layout(child, cx, y + NODE_H + V_GAP);
    cx += subtreeWidth(child) + H_GAP;
  }
  // center over children
  if (node.children.length) {
    const first = node.children[0];
    const last  = node.children[node.children.length - 1];
    node._x = (first._x + last._x) / 2;
  }
}

function allNodes(node, out = []) {
  out.push(node);
  node.children.forEach(c => allNodes(c, out));
  return out;
}

// ─── render ───────────────────────────────────────────────────────────────────

const totalTok = (function sum(n) { return n.inputTokens + n.children.reduce((s,c) => s+sum(c), 0); })(TREE);

function pct(val) {
  if (!totalTok) return '0%';
  return (val / totalTok * 100).toFixed(1) + '%';
}

function fmtTok(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n/1000).toFixed(1) + 'k';
  return String(n);
}

function fmtDur(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms/1000).toFixed(1) + 's';
  return Math.floor(ms/60000) + 'm ' + Math.floor((ms%60000)/1000) + 's';
}

function fmtTime(ts) {
  try { return new Date(ts).toTimeString().slice(0,8); } catch { return ts; }
}

layout(TREE, 0, 0);
const nodes = allNodes(TREE);

// compute bounding box
const pad = 40;
const xs = nodes.map(n => n._x);
const ys = nodes.map(n => n._y);
const minX = Math.min(...xs) - pad;
const minY = Math.min(...ys) - pad;
const maxX = Math.max(...xs) + NODE_W + pad;
const maxY = Math.max(...ys) + NODE_H + pad;
const svgW = maxX - minX;
const svgH = maxY - minY;

const svg = document.getElementById('graph-svg');
svg.setAttribute('width', svgW);
svg.setAttribute('height', svgH);

const edgesG = document.getElementById('edges');
const nodesG = document.getElementById('nodes');

function mkSvg(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// draw edges
function drawEdges(node) {
  for (const child of node.children) {
    const x1 = node._x - minX + NODE_W/2;
    const y1 = node._y - minY + NODE_H;
    const x2 = child._x - minX + NODE_W/2;
    const y2 = child._y - minY;
    const mx = (x1 + x2) / 2;
    const path = mkSvg('path', {
      class: 'edge',
      d: \`M\${x1},\${y1} C\${x1},\${mx} \${x2},\${mx} \${x2},\${y2}\`,
    });
    edgesG.appendChild(path);

    // edge label: child call count
    const lx = (x1 + x2) / 2;
    const ly = (y1 + y2) / 2;
    const lbl = mkSvg('text', { class: 'edge-label', x: lx + 4, y: ly, 'text-anchor': 'start' });
    lbl.textContent = child.callCount + ' calls';
    edgesG.appendChild(lbl);

    drawEdges(child);
  }
}
drawEdges(TREE);

// draw nodes
let selectedId = null;

function drawNode(node) {
  const nx = node._x - minX;
  const ny = node._y - minY;
  const g = mkSvg('g', { class: 'node-group', 'data-id': node.id });

  const rect = mkSvg('rect', {
    class: 'node-box',
    x: nx, y: ny,
    width: NODE_W, height: NODE_H,
    rx: 4,
  });
  g.appendChild(rect);

  // label (truncate)
  const maxLabelLen = 22;
  const labelText = node.label.length > maxLabelLen ? node.label.slice(0, maxLabelLen) + '…' : node.label;
  const lbl = mkSvg('text', { class: 'node-label', x: nx + NODE_W/2, y: ny + 18, 'text-anchor': 'middle' });
  lbl.textContent = labelText;
  g.appendChild(lbl);

  const s1 = mkSvg('text', { class: 'node-stat', x: nx + NODE_W/2, y: ny + 34, 'text-anchor': 'middle' });
  s1.textContent = fmtTok(node.inputTokens) + ' in tok';
  g.appendChild(s1);

  const s2 = mkSvg('text', { class: 'node-pct', x: nx + NODE_W/2, y: ny + 48, 'text-anchor': 'middle' });
  s2.textContent = pct(node.inputTokens) + ' of total · ' + fmtDur(node.durationMs);
  g.appendChild(s2);

  const s3 = mkSvg('text', { class: 'node-pct', x: nx + NODE_W/2, y: ny + 62, 'text-anchor': 'middle' });
  s3.textContent = node.callCount + ' call' + (node.callCount !== 1 ? 's' : '');
  g.appendChild(s3);

  g.addEventListener('click', (e) => {
    e.stopPropagation();
    selectNode(node, rect);
  });

  nodesG.appendChild(g);
  node.children.forEach(drawNode);
}
drawNode(TREE);

// ─── pan + zoom ────────────────────────────────────────────────────────────────

const wrap = document.getElementById('svg-wrap');
const container = document.getElementById('graph-container');
let scale = 1, tx = 40, ty = 40;

function applyTransform() {
  wrap.style.transform = \`translate(\${tx}px, \${ty}px) scale(\${scale})\`;
  document.getElementById('zoom-label').textContent = 'zoom: ' + Math.round(scale*100) + '%';
}
applyTransform();

container.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const rect = container.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  tx = mx - (mx - tx) * factor;
  ty = my - (my - ty) * factor;
  scale *= factor;
  applyTransform();
}, { passive: false });

let dragging = false, dragStartX, dragStartY, dragTx, dragTy;
container.addEventListener('mousedown', e => {
  dragging = true;
  dragStartX = e.clientX; dragStartY = e.clientY;
  dragTx = tx; dragTy = ty;
});
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  tx = dragTx + (e.clientX - dragStartX);
  ty = dragTy + (e.clientY - dragStartY);
  applyTransform();
});
window.addEventListener('mouseup', () => { dragging = false; });

// ─── detail panel ─────────────────────────────────────────────────────────────

function selectNode(node, rect) {
  // deselect previous
  document.querySelectorAll('.node-box.selected').forEach(el => el.classList.remove('selected'));
  rect.classList.add('selected');

  const panel = document.getElementById('detail-panel');
  const title = document.getElementById('detail-title');
  const body  = document.getElementById('detail-body');
  panel.classList.add('visible');
  title.textContent = node.label.length > 28 ? node.label.slice(0,28)+'…' : node.label;

  body.innerHTML = node.calls.map((call, i) => {
    const diffHtml = call.diff.map(e => {
      let content = '';
      if (e.isToolUse && e.toolName) {
        const m = e.contentSummary.match(/"(?:path|file_path|command)"\\s*:\\s*"([^"]+)"/);
        content = \`<span class="tool-badge">\${esc(e.toolName)}\${m ? ' → ' + esc(m[1]) : ''}</span>\`;
      } else if (e.contentSummary.includes('"type":"tool_result"') || e.contentSummary.includes('"type": "tool_result"')) {
        content = \`<span class="tool-result-badge">tool_result</span>\`;
      } else {
        const s = e.contentSummary.replace(/\\n/g,' ').slice(0,300);
        content = \`<span class="diff-content">\${esc(s)}\${e.contentSummary.length>300?'…':''}</span>\`;
      }
      return \`<div class="diff-line diff-\${esc(e.role)}"><span class="diff-role">\${esc(e.role)}</span>\${content}</div>\`;
    }).join('');

    return \`<div class="call-item" onclick="toggleCall(this)">
      <div class="call-row">
        <span class="call-idx">#\${call.callIndex}</span>
        <span class="call-time">\${fmtTime(call.ts)}</span>
        <span class="call-msgs">\${call.msgCount} msgs</span>
        <span class="call-tok">\${fmtTok(call.inputTokens)} in</span>
        <span class="call-dur">\${fmtDur(call.durationMs)}</span>
        \${call.contextReset ? '<span class="call-reset">[R]</span>' : ''}
      </div>
      <div class="call-detail">
        \${call.contextReset ? '<div class="reset-banner">⚠ Context reset</div>' : ''}
        \${diffHtml || '<span style="color:#ccc;font-size:11px">(no diff)</span>'}
        <div class="call-meta">
          <span>model: \${esc(call.model)}</span>
          <span>out: \${fmtTok(call.outputTokens)}</span>
          <span>cache: \${fmtTok(call.cacheTokens)}</span>
        </div>
      </div>
    </div>\`;
  }).join('');
}

function toggleCall(el) {
  el.classList.toggle('open');
}

document.getElementById('detail-close').addEventListener('click', () => {
  document.getElementById('detail-panel').classList.remove('visible');
  document.querySelectorAll('.node-box.selected').forEach(el => el.classList.remove('selected'));
});

// auto-open root
const rootRect = nodesG.querySelector('.node-box');
if (rootRect) selectNode(TREE, rootRect);

// ─── utils ────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>`;
}

// ─── public API ───────────────────────────────────────────────────────────────

export function generateReport(root: ConversationGroup, sessionId: string): string {
  const html = buildHtml(root, sessionId);
  const outDir = path.join(TRACER_DIR, 'sessions', sessionId);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'report.html');
  fs.writeFileSync(outPath, html, 'utf8');
  return outPath;
}
