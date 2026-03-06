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

// ─── tool classification ───────────────────────────────────────────────────────

type ToolKind = 'shell' | 'file' | 'web' | 'agent' | 'skill' | 'user' | 'other';

function classifyTool(toolName: string): ToolKind {
  const n = toolName.toLowerCase();
  if (/bash|shell|run|exec|terminal|command/.test(n)) return 'shell';
  if (/read|write|edit|multi.?edit|create|delete|file|glob|grep/.test(n)) return 'file';
  if (/web|search|fetch|browse|brave|url|http/.test(n)) return 'web';
  if (/task|agent|spawn|subagent/.test(n)) return 'agent';
  if (/skill/.test(n)) return 'skill';
  return 'other';
}

const KIND_STYLE: Record<ToolKind, { bg: string; border: string; label: string; dot: string }> = {
  shell:  { bg: '#0e2e12', border: '#238636', label: '#3fb950', dot: '#3fb950' },
  file:   { bg: '#0d2045', border: '#1f6feb', label: '#79c0ff', dot: '#58a6ff' },
  web:    { bg: '#1e0a38', border: '#6e40c9', label: '#bc8cff', dot: '#bc8cff' },
  agent:  { bg: '#2a1800', border: '#9e5000', label: '#f0883e', dot: '#f0883e' },
  skill:  { bg: '#2a0020', border: '#ad2d78', label: '#ff7eb6', dot: '#ff7eb6' },
  user:   { bg: '#161b22', border: '#30363d', label: '#8b949e', dot: '#8b949e' },
  other:  { bg: '#161b22', border: '#388bfd', label: '#79c0ff', dot: '#79c0ff' },
};

// ─── flat call ────────────────────────────────────────────────────────────────

interface FlatCall {
  call: CallRecord;
  groupLabel: string;
  groupId: string;
  groupChanged: boolean;         // true if this is first call of a new group
  primaryTool: string | null;    // primary tool_use name, or null
  toolKind: ToolKind;
  actionLabel: string;           // display label for the node
  inTok: number;                 // per-call input tokens (delta fallback)
  outTok: number;
}

function flattenCalls(root: ConversationGroup): FlatCall[] {
  // Collect all calls from all groups
  const all: { call: CallRecord; groupLabel: string; groupId: string }[] = [];

  function walk(g: ConversationGroup) {
    for (const c of g.calls) {
      all.push({ call: c, groupLabel: g.label, groupId: g.id });
    }
    g.children.forEach(walk);
  }
  walk(root);

  // Sort by timestamp
  all.sort((a, b) => new Date(a.call.ts).getTime() - new Date(b.call.ts).getTime());

  // Build flat list
  const result: FlatCall[] = [];
  let prevGroupId = '';
  let prevTokTotal = 0;

  for (const { call, groupLabel, groupId } of all) {
    const diff = (call.diff ?? []) as DiffEntry[];

    // Primary tool: last tool_use in diff (what the assistant DID in this call)
    const toolEntries = diff.filter(e => e.is_tool_use && e.tool_name);
    const primaryTool = toolEntries.length ? toolEntries[toolEntries.length - 1].tool_name! : null;

    // Tool kind
    const toolKind: ToolKind = primaryTool ? classifyTool(primaryTool) : 'user';

    // Action label
    let actionLabel: string;
    if (primaryTool) {
      // Try to extract target path/command from content_summary
      const last = toolEntries[toolEntries.length - 1];
      const pathMatch = last.content_summary.match(/"(?:path|file_path)"\s*:\s*"([^"]+)"/);
      const cmdMatch  = last.content_summary.match(/"command"\s*:\s*"([^"]{1,40})"/);
      const target = pathMatch ? pathMatch[1].split('/').pop() : cmdMatch ? cmdMatch[1].slice(0, 30) : null;
      actionLabel = target ? `${primaryTool}: ${target}` : primaryTool;
    } else {
      // Use first user message in diff
      const userEntry = diff.find(e => e.role === 'user' && !e.is_tool_use);
      if (userEntry) {
        actionLabel = userEntry.content_summary.replace(/\n/g, ' ').slice(0, 40);
        if (userEntry.content_summary.length > 40) actionLabel += '…';
      } else {
        actionLabel = '(continuation)';
      }
    }

    // Per-call input tokens: use usage.input_tokens; if 0, use delta of input_token_total
    let inTok = call.usage?.input_tokens ?? 0;
    if (inTok === 0 && call.input_token_total) {
      inTok = call.input_token_total - prevTokTotal;
      if (inTok < 0) inTok = call.input_token_total;
    }
    prevTokTotal = call.input_token_total ?? prevTokTotal;

    result.push({
      call,
      groupLabel,
      groupId,
      groupChanged: groupId !== prevGroupId,
      primaryTool,
      toolKind,
      actionLabel,
      inTok,
      outTok: call.usage?.output_tokens ?? 0,
    });
    prevGroupId = groupId;
  }

  return result;
}

// ─── serialize for JS ─────────────────────────────────────────────────────────

interface SerFlat {
  idx: number;
  ts: string;
  msgCount: number;
  inTok: number;
  outTok: number;
  cacheTok: number;
  durMs: number;
  model: string;
  reset: boolean;
  toolKind: ToolKind;
  actionLabel: string;
  groupLabel: string;
  groupChanged: boolean;
  diff: { role: string; isToolUse: boolean; toolName?: string; summary: string }[];
}

function serFlat(f: FlatCall): SerFlat {
  const c = f.call;
  return {
    idx: c.call_index,
    ts: c.ts,
    msgCount: (c.messages as unknown[]).length,
    inTok: f.inTok,
    outTok: f.outTok,
    cacheTok: c.usage?.cache_read_input_tokens ?? 0,
    durMs: c.duration_ms,
    model: c.model,
    reset: c.context_reset ?? false,
    toolKind: f.toolKind,
    actionLabel: f.actionLabel,
    groupLabel: f.groupLabel,
    groupChanged: f.groupChanged,
    diff: ((c.diff ?? []) as DiffEntry[]).map(e => ({
      role: e.role,
      isToolUse: e.is_tool_use,
      toolName: e.tool_name,
      summary: e.content_summary.slice(0, 400),
    })),
  };
}

function sumTok(g: ConversationGroup): number {
  return g.stats.totalInputTokens + g.children.reduce((s, c) => s + sumTok(c), 0);
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildHtml(root: ConversationGroup, sessionId: string, flatCalls: FlatCall[]): string {
  const data = JSON.stringify(flatCalls.map(serFlat));
  const totalTok = sumTok(root);
  const kindStyleJson = JSON.stringify(KIND_STYLE);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>claude-tracer: ${escHtml(sessionId)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family:'SF Mono','Fira Code','Consolas',monospace; font-size:13px; background:#0d1117; color:#c9d1d9; display:flex; flex-direction:column; height:100vh; }

#hdr { background:#161b22; border-bottom:1px solid #30363d; padding:9px 16px; display:flex; gap:18px; align-items:center; flex-shrink:0; }
#hdr h1 { font-size:14px; color:#58a6ff; font-weight:700; white-space:nowrap; }
.meta { font-size:11px; color:#8b949e; white-space:nowrap; }
#zlbl { margin-left:auto; font-size:11px; color:#484f58; white-space:nowrap; }

#legend { display:flex; gap:12px; align-items:center; padding:6px 16px; background:#0d1117; border-bottom:1px solid #21262d; flex-shrink:0; flex-wrap:wrap; }
.leg { display:flex; align-items:center; gap:5px; font-size:10px; color:#8b949e; }
.ldot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }

#main { display:flex; flex:1; overflow:hidden; }
#vp { flex:1; overflow:hidden; position:relative; cursor:grab; background:#0d1117; }
#vp:active { cursor:grabbing; }
#canvas { position:absolute; transform-origin:0 0; }
svg { overflow:visible; }

/* detail panel */
#dp { width:380px; border-left:1px solid #30363d; background:#0d1117; display:none; flex-direction:column; overflow:hidden; }
#dp.open { display:flex; }
#dph { padding:8px 14px; border-bottom:1px solid #30363d; display:flex; align-items:center; gap:8px; flex-shrink:0; }
#dph .dptitle { font-weight:700; color:#e6edf3; flex:1; font-size:12px; }
#dph .dpclose { cursor:pointer; color:#8b949e; font-size:16px; }
#dph .dpclose:hover { color:#e6edf3; }
#dpb { overflow-y:auto; flex:1; padding:10px 14px; }

.de { display:flex; gap:6px; align-items:flex-start; padding:3px 0; border-bottom:1px solid #21262d; font-size:11px; }
.de:last-child { border-bottom:none; }
.dr { min-width:64px; font-weight:600; font-size:10px; padding:2px 4px; border-radius:2px; flex-shrink:0; }
.du .dr { background:#0e4429; color:#3fb950; }
.da .dr { background:#0d419d; color:#79c0ff; }
.dc { color:#c9d1d9; word-break:break-word; }
.tb { background:#21262d; border:1px solid #30363d; padding:1px 5px; border-radius:3px; color:#79c0ff; font-size:10px; }
.trb { background:#21262d; border:1px solid #30363d; padding:1px 5px; border-radius:3px; color:#8b949e; font-size:10px; }
.dm { font-size:10px; color:#8b949e; margin-top:8px; display:flex; gap:10px; flex-wrap:wrap; border-top:1px solid #21262d; padding-top:6px; }
.rb { background:#3d1210; color:#f85149; font-size:11px; padding:3px 7px; border-radius:3px; margin-bottom:6px; font-weight:600; }

#dpb h3 { font-size:11px; color:#8b949e; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid #21262d; }
</style>
</head>
<body>
<div id="hdr">
  <h1>⚡ claude-tracer: ${escHtml(sessionId)}</h1>
  <span class="meta">${flatCalls.length} calls</span>
  <span class="meta">Session tokens: ${fmt(totalTok)}</span>
  <span class="meta">${new Date().toISOString().slice(0, 19).replace('T', ' ')}</span>
  <span id="zlbl">scroll=zoom · drag=pan · click=detail</span>
</div>
<div id="legend">
  <span class="leg"><span class="ldot" style="background:#3fb950"></span>shell/exec</span>
  <span class="leg"><span class="ldot" style="background:#58a6ff"></span>file I/O</span>
  <span class="leg"><span class="ldot" style="background:#bc8cff"></span>web/search</span>
  <span class="leg"><span class="ldot" style="background:#f0883e"></span>agent/task</span>
  <span class="leg"><span class="ldot" style="background:#ff7eb6"></span>skill</span>
  <span class="leg"><span class="ldot" style="background:#8b949e"></span>user/other</span>
</div>
<div id="main">
  <div id="vp">
    <div id="canvas"><svg id="svg"></svg></div>
  </div>
  <div id="dp">
    <div id="dph">
      <span class="dptitle" id="dptitle">Call detail</span>
      <span class="dpclose" id="dpclose">✕</span>
    </div>
    <div id="dpb" id="dpbody"></div>
  </div>
</div>
<script>
const CALLS = ${data};
const STYLES = ${kindStyleJson};

const NW = 260, NH = 58, VGAP = 28, PAD = 40;
const COL_W = NW + 80;   // column width inc gap (for multi-column future use)

// ─── compute per-call cumulative token totals for sparkline ───────────────────
let runTotal = 0;
const tokByIdx = CALLS.map(c => { runTotal += c.inTok; return runTotal; });

// ─── layout: single vertical column ──────────────────────────────────────────
// Each call is placed at (PADX, PAD + i*(NH+VGAP))
const PADX = PAD;
const totalH = PAD + CALLS.length * (NH + VGAP) + PAD;
const totalW = PADX + NW + PAD + 200; // extra right space for labels

const svg = document.getElementById('svg');
svg.setAttribute('width', totalW);
svg.setAttribute('height', totalH);

const SVG_NS = 'http://www.w3.org/2000/svg';
function mk(tag, attrs={}) {
  const el = document.createElementNS(SVG_NS, tag);
  for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,String(v));
  return el;
}

// defs: arrow markers per kind
const defs = mk('defs');
const kinds = [...new Set(CALLS.map(c=>c.toolKind))];
for (const kind of kinds) {
  const col = STYLES[kind]?.border ?? '#484f58';
  const m = mk('marker', {id:'arr_'+kind, markerWidth:'7',markerHeight:'6',refX:'6',refY:'3',orient:'auto'});
  const p = mk('polygon', {points:'0,0 7,3 0,6', fill:col});
  m.appendChild(p); defs.appendChild(m);
}
// group-change arrow (dashed)
const gm = mk('marker', {id:'arr_group',markerWidth:'7',markerHeight:'6',refX:'6',refY:'3',orient:'auto'});
const gp = mk('polygon', {points:'0,0 7,3 0,6',fill:'#484f58'});
gm.appendChild(gp); defs.appendChild(gm);
svg.appendChild(defs);

const eG = mk('g'); svg.appendChild(eG);
const nG = mk('g'); svg.appendChild(nG);

function fmtTok(n) {
  if(!n) return '—';
  return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1000?(n/1000).toFixed(1)+'k':String(n);
}
function fmtDur(ms) {
  if(ms<1000) return ms+'ms';
  if(ms<60000) return (ms/1000).toFixed(1)+'s';
  return Math.floor(ms/60000)+'m '+Math.floor((ms%60000)/1000)+'s';
}
function fmtTime(ts){ try{return new Date(ts).toTimeString().slice(0,8);}catch{return ts;} }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── draw edges first ─────────────────────────────────────────────────────────
for (let i = 0; i < CALLS.length - 1; i++) {
  const c = CALLS[i], nextC = CALLS[i+1];
  const x1 = PADX + NW/2;
  const y1 = PAD + i*(NH+VGAP) + NH;
  const y2 = PAD + (i+1)*(NH+VGAP);
  const x2 = x1;
  const col = STYLES[c.toolKind]?.border ?? '#484f58';

  if (nextC.groupChanged) {
    // dashed line for group transition
    const line = mk('line', {x1,y1,x2,y2,stroke:'#484f58','stroke-width':'1.5','stroke-dasharray':'4 3'});
    line.setAttribute('marker-end','url(#arr_group)');
    eG.appendChild(line);
  } else {
    const line = mk('line', {x1,y1,x2,y2,stroke:col,'stroke-width':'1.5'});
    line.setAttribute('marker-end','url(#arr_'+c.toolKind+')');
    eG.appendChild(line);
  }
}

// ─── draw nodes ───────────────────────────────────────────────────────────────
let activeNode = null;

CALLS.forEach((c, i) => {
  const st = STYLES[c.toolKind] ?? STYLES.other;
  const nx = PADX, ny = PAD + i*(NH+VGAP);

  // group separator label
  if (c.groupChanged && i > 0) {
    const sep = mk('text', {x: nx, y: ny - 12, 'text-anchor':'start',
      style:'font-size:9px;fill:#484f58;font-family:monospace'});
    sep.textContent = '↳ ' + (c.groupLabel.length>40?c.groupLabel.slice(0,40)+'…':c.groupLabel);
    nG.appendChild(sep);
  }

  const g = mk('g', {'data-idx':i});
  g.style.cursor = 'pointer';

  // background rect
  const rect = mk('rect', {x:nx,y:ny,width:NW,height:NH,fill:st.bg,stroke:st.border,rx:5,'stroke-width':'1.5'});
  g.appendChild(rect);

  // left accent bar
  const bar = mk('rect', {x:nx,y:ny,width:4,height:NH,fill:st.border,rx:2});
  g.appendChild(bar);

  // call index + time (top-left)
  const t1 = mk('text', {x:nx+12,y:ny+14,style:'font-size:10px;fill:#8b949e;font-family:monospace'});
  t1.textContent = '#'+c.idx+'  '+fmtTime(c.ts);
  g.appendChild(t1);

  // action label (main, center-ish)
  const maxA = 28;
  const aLabel = c.actionLabel.length>maxA ? c.actionLabel.slice(0,maxA)+'…' : c.actionLabel;
  const t2 = mk('text', {x:nx+12,y:ny+32,style:\`font-size:13px;font-weight:700;fill:\${st.label};font-family:monospace\`});
  t2.textContent = aLabel;
  g.appendChild(t2);

  // tokens + duration (bottom)
  const tokStr = c.inTok ? fmtTok(c.inTok)+' in' : '— tok';
  const t3 = mk('text', {x:nx+12,y:ny+48,style:'font-size:10px;fill:#8b949e;font-family:monospace'});
  t3.textContent = tokStr + '  ·  ' + fmtDur(c.durMs) + '  ·  ' + c.msgCount+' msgs';
  g.appendChild(t3);

  // reset indicator
  if (c.reset) {
    const rb = mk('text', {x:nx+NW-8,y:ny+14,'text-anchor':'end',style:'font-size:10px;fill:#f85149;font-weight:700'});
    rb.textContent = '[R]';
    g.appendChild(rb);
  }

  g.addEventListener('click', e => {
    e.stopPropagation();
    if(activeNode) activeNode.querySelector('rect').setAttribute('stroke-width','1.5');
    rect.setAttribute('stroke-width','2.5');
    activeNode = g;
    openDetail(c, i);
  });

  nG.appendChild(g);
});

// ─── detail panel ─────────────────────────────────────────────────────────────
function openDetail(c, i) {
  const panel = document.getElementById('dp');
  panel.classList.add('open');

  const title = document.getElementById('dptitle');
  title.textContent = '#'+c.idx+' '+c.actionLabel;

  const body = document.getElementById('dpb');
  const st = STYLES[c.toolKind] ?? STYLES.other;

  const diffHtml = c.diff.map(e => {
    let content = '';
    if (e.isToolUse && e.toolName) {
      const m = e.summary.match(/"(?:path|file_path|command)"\\s*:\\s*"([^"]+)"/);
      content = \`<span class="tb">\${esc(e.toolName)}\${m?' → '+esc(m[1]):''}</span>\`;
    } else if (e.summary.includes('"type":"tool_result"')||e.summary.includes('"type": "tool_result"')) {
      const lm = e.summary.match(/"content"\\s*:\\s*"([^"]*)"/);
      const chars = lm ? lm[1].length : 0;
      content = \`<span class="trb">tool_result\${chars?': '+chars+' chars':''}</span>\`;
    } else {
      const s = e.summary.replace(/\\n/g,' ').slice(0,350);
      content = \`<span class="dc">\${esc(s)}\${e.summary.length>350?'…':''}</span>\`;
    }
    return \`<div class="de d\${esc(e.role[0])}"><span class="dr">\${esc(e.role)}</span>\${content}</div>\`;
  }).join('');

  body.innerHTML = \`
<h3 style="color:\${esc(st.label)}">\${esc(c.actionLabel)}</h3>
\${c.reset ? '<div class="rb">⚠ Context reset — all messages new</div>' : ''}
\${diffHtml || '<span style="color:#484f58;font-size:11px">(no diff data)</span>'}
<div class="dm">
  <span>in: \${fmtTok(c.inTok)}</span>
  <span>out: \${fmtTok(c.outTok)}</span>
  <span>cache: \${fmtTok(c.cacheTok)}</span>
  <span>\${esc(c.model)}</span>
  <span>\${fmtDur(c.durMs)}</span>
</div>\`;
}

document.getElementById('dpclose').addEventListener('click', () => {
  document.getElementById('dp').classList.remove('open');
  if(activeNode){ activeNode.querySelector('rect').setAttribute('stroke-width','1.5'); activeNode=null; }
});

// auto-open first call
if(CALLS.length) {
  openDetail(CALLS[0], 0);
  nG.firstChild?.querySelector('rect')?.setAttribute('stroke-width','2.5');
  activeNode = nG.firstChild;
}

// ─── pan + zoom ───────────────────────────────────────────────────────────────
const vp = document.getElementById('vp');
const canvas = document.getElementById('canvas');
let scale=1, tx=40, ty=20;

function applyT() {
  canvas.style.transform=\`translate(\${tx}px,\${ty}px) scale(\${scale})\`;
  document.getElementById('zlbl').textContent='zoom: '+Math.round(scale*100)+'% · scroll=zoom · drag=pan · click=detail';
}
applyT();

vp.addEventListener('wheel', e=>{
  e.preventDefault();
  const f=e.deltaY<0?1.12:0.9;
  const r=vp.getBoundingClientRect();
  tx=(e.clientX-r.left)-(e.clientX-r.left-tx)*f;
  ty=(e.clientY-r.top)-(e.clientY-r.top-ty)*f;
  scale*=f; applyT();
},{passive:false});

let drag=false,dsx,dsy,dtx,dty;
vp.addEventListener('mousedown',e=>{drag=true;dsx=e.clientX;dsy=e.clientY;dtx=tx;dty=ty;});
window.addEventListener('mousemove',e=>{if(!drag)return;tx=dtx+(e.clientX-dsx);ty=dty+(e.clientY-dsy);applyT();});
window.addEventListener('mouseup',()=>{drag=false;});
</script>
</body>
</html>`;
}

export function generateReport(root: ConversationGroup, sessionId: string): string {
  const flatCalls = flattenCalls(root);
  const html = buildHtml(root, sessionId, flatCalls);
  const outDir = path.join(TRACER_DIR, 'sessions', sessionId);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'report.html');
  fs.writeFileSync(outPath, html, 'utf8');
  return outPath;
}
