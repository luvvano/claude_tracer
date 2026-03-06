import * as fs from 'fs';
import * as path from 'path';
import { ConversationGroup, CallRecord, DiffEntry } from './types';
import { TRACER_DIR, fmt, fmtTime } from './shared';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── serialize ────────────────────────────────────────────────────────────────

interface SerializedGroup {
  id: string;
  label: string;
  callCount: number;
  inputTok: number;
  outputTok: number;
  durationMs: number;
  children: SerializedGroup[];
  calls: SerializedCall[];
}

interface SerializedCall {
  idx: number;
  ts: string;
  msgCount: number;
  inTok: number;
  outTok: number;
  cacheTok: number;
  durMs: number;
  model: string;
  reset: boolean;
  diff: { role: string; isToolUse: boolean; toolName?: string; summary: string }[];
}

function serializeCall(c: CallRecord): SerializedCall {
  const inTok = c.usage?.input_tokens ?? 0;
  const outTok = c.usage?.output_tokens ?? 0;
  return {
    idx: c.call_index,
    ts: c.ts,
    msgCount: (c.messages as unknown[]).length,
    inTok,
    outTok,
    cacheTok: c.usage?.cache_read_input_tokens ?? 0,
    durMs: c.duration_ms,
    model: c.model,
    reset: c.context_reset ?? false,
    diff: ((c.diff ?? []) as DiffEntry[]).map(e => ({
      role: e.role,
      isToolUse: e.is_tool_use,
      toolName: e.tool_name,
      summary: e.content_summary.slice(0, 400),
    })),
  };
}

function serializeGroup(g: ConversationGroup): SerializedGroup {
  return {
    id: g.id,
    label: g.label,
    callCount: g.stats.callCount,
    inputTok: g.stats.totalInputTokens,
    outputTok: g.stats.totalOutputTokens,
    durationMs: g.stats.durationMs,
    children: g.children.map(serializeGroup),
    calls: g.calls.map(serializeCall),
  };
}

function sumTok(g: ConversationGroup): number {
  return g.stats.totalInputTokens + g.children.reduce((s, c) => s + sumTok(c), 0);
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildHtml(root: ConversationGroup, sessionId: string): string {
  const data = JSON.stringify(serializeGroup(root));
  const totalTok = sumTok(root);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>claude-tracer: ${escHtml(sessionId)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'SF Mono','Fira Code','Consolas',monospace; font-size: 13px; background:#0d1117; color:#c9d1d9; }
#hdr { background:#161b22; border-bottom:1px solid #30363d; padding:10px 16px; display:flex; gap:20px; align-items:center; position:sticky; top:0; z-index:10; }
#hdr h1 { font-size:14px; color:#58a6ff; font-weight:700; }
.meta { font-size:11px; color:#8b949e; }
#zoom { font-size:11px; color:#8b949e; margin-left:auto; }
#viewport { width:100%; height:calc(100vh - 41px); overflow:hidden; position:relative; cursor:grab; background:#0d1117; }
#viewport:active { cursor:grabbing; }
#canvas { position:absolute; transform-origin:0 0; }
/* SVG */
svg { overflow:visible; }
.edge { fill:none; stroke:#484f58; stroke-width:1.5; }
.edge-spawn { fill:none; stroke:#388bfd; stroke-width:1.5; stroke-dasharray:4 3; }
/* Nodes */
.gnode { cursor:pointer; }
.gnode rect { rx:6; stroke-width:1.5; transition:filter .15s; }
.gnode:hover rect { filter:brightness(1.25); }
.gnode.active rect { stroke-width:2.5 !important; }
.gnode text { font-family:'SF Mono','Fira Code','Consolas',monospace; }
/* Detail panel */
#detail { position:fixed; bottom:0; left:0; right:0; max-height:45vh; background:#161b22; border-top:2px solid #30363d; z-index:20; display:none; overflow:hidden; flex-direction:column; }
#detail.open { display:flex; }
#dh { padding:8px 16px; border-bottom:1px solid #30363d; display:flex; align-items:center; gap:10px; flex-shrink:0; }
#dh strong { color:#e6edf3; font-size:13px; }
#dh .ds { color:#8b949e; font-size:11px; }
#dclose { margin-left:auto; cursor:pointer; color:#8b949e; font-size:18px; line-height:1; }
#dclose:hover { color:#e6edf3; }
#dcalls { overflow-y:auto; flex:1; }
.ci { border-bottom:1px solid #21262d; }
.ch { display:flex; gap:10px; align-items:center; padding:6px 16px; cursor:pointer; font-size:12px; }
.ch:hover { background:#21262d; }
.ci.open .ch { background:#1c2333; }
.cn { color:#8b949e; min-width:30px; }
.ct { color:#3fb950; min-width:62px; }
.cm { color:#79c0ff; min-width:48px; }
.ck { color:#e3b341; min-width:80px; }
.cd { color:#8b949e; }
.cr { color:#f85149; font-weight:700; margin-left:4px; }
.ca { display:none; padding:6px 16px 10px 44px; }
.ci.open .ca { display:block; }
.de { display:flex; gap:8px; align-items:flex-start; padding:3px 0; border-bottom:1px solid #21262d; font-size:11px; }
.de:last-child { border-bottom:none; }
.dr { min-width:66px; font-weight:600; font-size:10px; padding:2px 5px; border-radius:2px; }
.du .dr { background:#0e4429; color:#3fb950; }
.da .dr { background:#0d419d; color:#79c0ff; }
.dc { color:#c9d1d9; word-break:break-word; }
.tb { background:#21262d; border:1px solid #30363d; padding:1px 5px; border-radius:3px; color:#79c0ff; font-size:10px; }
.trb { background:#21262d; border:1px solid #30363d; padding:1px 5px; border-radius:3px; color:#8b949e; font-size:10px; }
.dm { font-size:10px; color:#8b949e; padding-top:4px; display:flex; gap:10px; flex-wrap:wrap; border-top:1px solid #21262d; margin-top:4px; }
.rb { background:#3d1210; color:#f85149; font-weight:600; padding:3px 8px; border-radius:3px; font-size:11px; margin-bottom:4px; }
</style>
</head>
<body>
<div id="hdr">
  <h1>⚡ claude-tracer: ${escHtml(sessionId)}</h1>
  <span class="meta">Total input tokens: ${fmt(totalTok)}</span>
  <span class="meta">${new Date().toISOString()}</span>
  <span id="zoom">zoom: 100% · scroll=zoom · drag=pan</span>
</div>
<div id="viewport">
  <div id="canvas">
    <svg id="svg"></svg>
  </div>
</div>
<div id="detail">
  <div id="dh">
    <strong id="dtitle"></strong>
    <span class="ds" id="dstats"></span>
    <span id="dclose">✕</span>
  </div>
  <div id="dcalls"></div>
</div>
<script>
const ROOT = ${data};

// ─── layout constants ─────────────────────────────────────────────────────────
const NW = 190, NH = 76, HGAP = 48, VGAP = 80;

// ─── recursive subtree width ──────────────────────────────────────────────────
function treeW(n) {
  if (!n.children.length) return NW;
  const cw = n.children.reduce((s,c) => s + treeW(c), 0) + HGAP * (n.children.length - 1);
  return Math.max(NW, cw);
}

// ─── layout: assign _x, _y ───────────────────────────────────────────────────
function layout(n, x, y) {
  n._y = y;
  if (!n.children.length) { n._x = x; return; }
  const tw = n.children.reduce((s,c) => s + treeW(c), 0) + HGAP*(n.children.length-1);
  let cx = x - tw/2 + treeW(n.children[0])/2;
  n.children.forEach(c => {
    layout(c, cx, y + NH + VGAP);
    cx += treeW(c) + HGAP;
  });
  const f = n.children[0], l = n.children[n.children.length-1];
  n._x = (f._x + l._x) / 2;
}

function allNodes(n, out=[]) { out.push(n); n.children.forEach(c=>allNodes(c,out)); return out; }

layout(ROOT, 0, 0);
const nodes = allNodes(ROOT);

// bounding box
const PAD = 60;
const xs = nodes.map(n=>n._x), ys = nodes.map(n=>n._y);
const ox = Math.min(...xs) - PAD, oy = Math.min(...ys) - PAD;
const sw = Math.max(...xs) - Math.min(...xs) + NW + PAD*2;
const sh = Math.max(...ys) - Math.min(...ys) + NH + PAD*2;

// total tokens (for %)
function sumTok(n) { return n.inputTok + n.children.reduce((s,c)=>s+sumTok(c),0); }
const TOTAL = sumTok(ROOT) || 1;

function fmtTok(n) { return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1000?(n/1000).toFixed(1)+'k':String(n); }
function fmtDur(ms) {
  if(ms<1000) return ms+'ms';
  if(ms<60000) return (ms/1000).toFixed(1)+'s';
  return Math.floor(ms/60000)+'m '+Math.floor((ms%60000)/1000)+'s';
}
function fmtTime(ts){ try{return new Date(ts).toTimeString().slice(0,8);}catch{return ts;} }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Colors per depth (pprof-inspired)
const COLORS = [
  {fill:'#0d2045', stroke:'#1f6feb', text:'#79c0ff'},  // depth 0 - blue
  {fill:'#12260e', stroke:'#238636', text:'#3fb950'},   // depth 1 - green
  {fill:'#1e0a2e', stroke:'#6e40c9', text:'#bc8cff'},   // depth 2 - purple
  {fill:'#2a150a', stroke:'#9e4e00', text:'#f0883e'},   // depth 3 - orange
  {fill:'#0a1f2a', stroke:'#1158a7', text:'#58a6ff'},   // depth 4 - cyan
];
function clr(depth) { return COLORS[Math.min(depth, COLORS.length-1)]; }

const SVG_NS = 'http://www.w3.org/2000/svg';
function mk(tag, attrs={}) {
  const el = document.createElementNS(SVG_NS, tag);
  for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
  return el;
}

const svg = document.getElementById('svg');
svg.setAttribute('width', sw);
svg.setAttribute('height', sh);

// arrow marker
const defs = mk('defs');
const marker = mk('marker', {id:'arr',markerWidth:'8',markerHeight:'6',refX:'7',refY:'3',orient:'auto'});
const poly = mk('polygon', {points:'0,0 8,3 0,6',fill:'#484f58'});
marker.appendChild(poly);
defs.appendChild(marker);
svg.appendChild(defs);

const markerSpawn = mk('marker', {id:'arr2',markerWidth:'8',markerHeight:'6',refX:'7',refY:'3',orient:'auto'});
const poly2 = mk('polygon', {points:'0,0 8,3 0,6',fill:'#388bfd'});
markerSpawn.appendChild(poly2);
defs.appendChild(markerSpawn);

const eG = mk('g'); svg.appendChild(eG);
const nG = mk('g'); svg.appendChild(nG);

// draw edges
function drawEdge(parent, child, depth) {
  const x1 = parent._x - ox + NW/2;
  const y1 = parent._y - oy + NH;
  const x2 = child._x - ox + NW/2;
  const y2 = child._y - oy;
  const my = (y1 + y2) / 2;
  const isChild = depth > 0;
  const p = mk('path', {
    class: isChild ? 'edge-spawn' : 'edge',
    d: \`M\${x1},\${y1} C\${x1},\${my} \${x2},\${my} \${x2},\${y2}\`,
  });
  p.setAttribute('marker-end', isChild ? 'url(#arr2)' : 'url(#arr)');
  eG.appendChild(p);

  // edge label
  const t = mk('text', {'text-anchor':'middle', x:(x1+x2)/2, y:(y1+y2)/2-4,
    style:'font-size:10px;fill:#484f58;font-family:monospace'});
  t.textContent = child.callCount + ' call' + (child.callCount!==1?'s':'');
  eG.appendChild(t);
}

function drawEdges(n, depth=0) {
  n.children.forEach(c => { drawEdge(n, c, depth); drawEdges(c, depth+1); });
}
drawEdges(ROOT);

// draw nodes
let activeEl = null;

function drawNode(n, depth) {
  const nx = n._x - ox, ny = n._y - oy;
  const c = clr(depth);
  const pct = TOTAL>0?(n.inputTok/TOTAL*100).toFixed(1):'0.0';

  const g = mk('g', {class:'gnode'});

  const rect = mk('rect', {
    x:nx, y:ny, width:NW, height:NH,
    fill:c.fill, stroke:c.stroke, rx:5,
  });
  g.appendChild(rect);

  // label
  const maxL = 24;
  const label = n.label.length>maxL ? n.label.slice(0,maxL)+'…' : n.label;
  const t1 = mk('text', {x:nx+NW/2, y:ny+17, 'text-anchor':'middle',
    style:\`font-size:12px;font-weight:700;fill:\${c.text}\`});
  t1.textContent = label;
  g.appendChild(t1);

  const tok = fmtTok(n.inputTok);
  const t2 = mk('text', {x:nx+NW/2, y:ny+33, 'text-anchor':'middle',
    style:'font-size:11px;fill:#e3b341'});
  t2.textContent = tok + ' in tok';
  g.appendChild(t2);

  const t3 = mk('text', {x:nx+NW/2, y:ny+48, 'text-anchor':'middle',
    style:'font-size:10px;fill:#8b949e'});
  t3.textContent = pct + '% of total · ' + fmtDur(n.durationMs);
  g.appendChild(t3);

  const t4 = mk('text', {x:nx+NW/2, y:ny+63, 'text-anchor':'middle',
    style:'font-size:10px;fill:#8b949e'});
  t4.textContent = n.callCount + ' call' + (n.callCount!==1?'s':'');
  g.appendChild(t4);

  g.addEventListener('click', e => {
    e.stopPropagation();
    if(activeEl) activeEl.classList.remove('active');
    g.classList.add('active');
    activeEl = g;
    openDetail(n);
  });

  nG.appendChild(g);
  n.children.forEach(c2 => drawNode(c2, depth+1));
}
drawNode(ROOT, 0);

// auto-open root
openDetail(ROOT);
nG.firstChild?.classList.add('active');
activeEl = nG.firstChild;

// ─── detail panel ─────────────────────────────────────────────────────────────

function openDetail(n) {
  const panel = document.getElementById('detail');
  panel.classList.add('open');
  document.getElementById('dtitle').textContent = n.label;
  document.getElementById('dstats').textContent =
    n.callCount + ' calls · ' + fmtTok(n.inputTok) + ' in tok · ' + fmtDur(n.durationMs);

  const body = document.getElementById('dcalls');
  body.innerHTML = n.calls.map((call,i) => {
    const diffHtml = call.diff.map(e => {
      let content = '';
      if (e.isToolUse && e.toolName) {
        const m = e.summary.match(/"(?:path|file_path|command)"\\s*:\\s*"([^"]+)"/);
        content = \`<span class="tb">\${esc(e.toolName)}\${m?' → '+esc(m[1]):''}</span>\`;
      } else if (e.summary.includes('"type":"tool_result"')||e.summary.includes('"type": "tool_result"')) {
        content = '<span class="trb">tool_result</span>';
      } else {
        const s = e.summary.replace(/\\n/g,' ').slice(0,300);
        content = \`<span class="dc">\${esc(s)}\${e.summary.length>300?'…':''}</span>\`;
      }
      return \`<div class="de d\${esc(e.role[0])}"><span class="dr">\${esc(e.role)}</span>\${content}</div>\`;
    }).join('');

    return \`<div class="ci">
  <div class="ch" onclick="toggleCall(this.parentElement)">
    <span class="cn">#\${call.idx}</span>
    <span class="ct">\${fmtTime(call.ts)}</span>
    <span class="cm">\${call.msgCount} msgs</span>
    <span class="ck">\${fmtTok(call.inTok)} in</span>
    <span class="cd">\${fmtDur(call.durMs)}</span>
    \${call.reset?'<span class="cr">[R]</span>':''}
  </div>
  <div class="ca">
    \${call.reset?'<div class="rb">⚠ Context reset</div>':''}
    \${diffHtml||'<span style="color:#484f58;font-size:11px">(no diff)</span>'}
    <div class="dm">
      <span>out: \${fmtTok(call.outTok)}</span>
      <span>cache: \${fmtTok(call.cacheTok)}</span>
      <span>\${esc(call.model)}</span>
    </div>
  </div>
</div>\`;
  }).join('');
}

function toggleCall(el) { el.classList.toggle('open'); }

document.getElementById('dclose').addEventListener('click', () => {
  document.getElementById('detail').classList.remove('open');
  if(activeEl){ activeEl.classList.remove('active'); activeEl=null; }
});

// ─── pan + zoom ───────────────────────────────────────────────────────────────
const vp = document.getElementById('viewport');
const canvas = document.getElementById('canvas');
let scale=1, tx=80, ty=40;

function applyT() {
  canvas.style.transform=\`translate(\${tx}px,\${ty}px) scale(\${scale})\`;
  document.getElementById('zoom').textContent='zoom: '+Math.round(scale*100)+'% · scroll=zoom · drag=pan';
}
applyT();

vp.addEventListener('wheel', e => {
  e.preventDefault();
  const f = e.deltaY<0?1.1:0.9;
  const r = vp.getBoundingClientRect();
  const mx=e.clientX-r.left, my=e.clientY-r.top;
  tx = mx-(mx-tx)*f; ty = my-(my-ty)*f; scale*=f;
  applyT();
}, {passive:false});

let drag=false,dsx,dsy,dtx,dty;
vp.addEventListener('mousedown', e=>{drag=true;dsx=e.clientX;dsy=e.clientY;dtx=tx;dty=ty;});
window.addEventListener('mousemove', e=>{if(!drag)return;tx=dtx+(e.clientX-dsx);ty=dty+(e.clientY-dsy);applyT();});
window.addEventListener('mouseup', ()=>{drag=false;});
</script>
</body>
</html>`;
}

export function generateReport(root: ConversationGroup, sessionId: string): string {
  const html = buildHtml(root, sessionId);
  const outDir = path.join(TRACER_DIR, 'sessions', sessionId);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'report.html');
  fs.writeFileSync(outPath, html, 'utf8');
  return outPath;
}
