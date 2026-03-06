import { CallRecord, ConversationGroup, ConversationGroupStats } from './types';

// ─── system prompt helpers ────────────────────────────────────────────────────

// Anthropic API allows system as array of content blocks; proxy stores as JSON.stringify'd
function extractSystemText(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = String(raw);
  if (s.trimStart().startsWith('[')) {
    try {
      const blocks = JSON.parse(s) as Array<Record<string, unknown>>;
      return blocks
        .filter(b => b['type'] === 'text')
        .map(b => String(b['text'] ?? ''))
        .join('\n');
    } catch { /* fall through */ }
  }
  return s;
}

// Fingerprint: skip first 200 chars (may contain dynamic date/time/session info),
// use next 400 chars of extracted text (stable tool definitions, instructions, etc.)
function fingerprint(system: string | null | undefined): string {
  if (!system) return '__no_system__';
  const text = extractSystemText(system);
  if (text.length < 50) return text || '__empty__';
  // Use a window from the stable middle of the prompt
  const start = Math.min(200, Math.floor(text.length * 0.1));
  const end   = Math.min(start + 400, text.length);
  return text.slice(start, end);
}

function computeStats(calls: CallRecord[]): ConversationGroupStats {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  for (const c of calls) {
    if (c.usage) {
      totalInputTokens += c.usage.input_tokens ?? 0;
      totalOutputTokens += c.usage.output_tokens ?? 0;
      totalCacheReadTokens += c.usage.cache_read_input_tokens ?? 0;
    }
  }
  // Fallback: use input_token_total from last call if per-call usage is 0
  if (totalInputTokens === 0 && calls.length) {
    const lastTotal = calls[calls.length - 1].input_token_total;
    if (lastTotal && lastTotal > 0) totalInputTokens = lastTotal;
  }
  const firstTs = calls[0]?.ts ?? '';
  const lastTs  = calls[calls.length - 1]?.ts ?? '';
  const durationMs = calls.length >= 2
    ? new Date(lastTs).getTime() - new Date(firstTs).getTime() + (calls[calls.length - 1]?.duration_ms ?? 0)
    : (calls[0]?.duration_ms ?? 0);
  return { totalInputTokens, totalOutputTokens, totalCacheReadTokens, callCount: calls.length, firstTs, lastTs, durationMs };
}

function extractLabel(system: string | null | undefined, isRoot: boolean): string {
  if (isRoot) return 'main session';
  if (!system) return '(no system prompt)';
  const text = extractSystemText(system);
  // Find first non-empty, non-JSON, human-readable line
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('{') && !l.startsWith('['));
  const label = lines[0] ?? '(subagent)';
  return label.length > 60 ? label.slice(0, 60) + '\u2026' : label;
}

export function buildCallTree(calls: CallRecord[]): ConversationGroup {
  if (calls.length === 0) {
    return {
      id: 'empty', systemSnippet: '', label: 'empty session',
      calls: [], children: [],
      stats: { totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, callCount: 0, firstTs: '', lastTs: '', durationMs: 0 },
    };
  }

  // Step 1: Group by fingerprint
  const groups = new Map<string, CallRecord[]>();
  for (const call of calls) {
    const fp = fingerprint(call.system);
    if (!groups.has(fp)) groups.set(fp, []);
    groups.get(fp)!.push(call);
  }

  // Step 2: Root = group containing first call (or largest group on tie)
  const firstFp = fingerprint(calls[0].system);
  let rootFp = firstFp;
  for (const [fp, gc] of groups.entries()) {
    if (gc.length > (groups.get(rootFp)?.length ?? 0)) rootFp = fp;
  }
  if ((groups.get(firstFp)?.length ?? 0) >= (groups.get(rootFp)?.length ?? 0)) rootFp = firstFp;

  // Step 3: Assign parent by timestamp overlap with root calls
  const rootSorted = [...(groups.get(rootFp) ?? [])].sort((a, b) =>
    new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );
  const groupMeta = new Map<string, { parentCallIndex?: number; parentGroupId?: string }>();

  for (const [fp, gc] of groups.entries()) {
    if (fp === rootFp) continue;
    const childStart = new Date(gc[0].ts).getTime();
    let parentCall: CallRecord | undefined;
    for (let i = rootSorted.length - 1; i >= 0; i--) {
      if (new Date(rootSorted[i].ts).getTime() <= childStart) { parentCall = rootSorted[i]; break; }
    }
    groupMeta.set(fp, parentCall
      ? { parentCallIndex: parentCall.call_index, parentGroupId: rootFp }
      : {}
    );
  }

  // Step 4: Build objects
  const objs = new Map<string, ConversationGroup>();
  for (const [fp, gc] of groups.entries()) {
    const sorted = [...gc].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const meta = groupMeta.get(fp) ?? {};
    objs.set(fp, {
      id: fp.slice(0, 40),
      systemSnippet: fp.slice(0, 80),
      label: extractLabel(gc[0].system, fp === rootFp),
      calls: sorted,
      parentCallIndex: meta.parentCallIndex,
      parentGroupId: meta.parentGroupId,
      children: [],
      stats: computeStats(sorted),
    });
  }

  // Step 5: Wire parent → children
  const root = objs.get(rootFp)!;
  for (const [fp, g] of objs.entries()) {
    if (fp === rootFp) continue;
    const parent = g.parentGroupId ? objs.get(g.parentGroupId) : undefined;
    (parent ?? root).children.push(g);
  }

  function sortChildren(g: ConversationGroup): void {
    g.children.sort((a, b) => new Date(a.stats.firstTs).getTime() - new Date(b.stats.firstTs).getTime());
    g.children.forEach(sortChildren);
  }
  sortChildren(root);

  return root;
}
