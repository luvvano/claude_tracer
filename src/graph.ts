import { CallRecord, ConversationGroup, ConversationGroupStats } from './types';

// Fingerprint: first 200 chars of system prompt (or full if shorter)
function fingerprint(system: string | null | undefined): string {
  if (!system) return '__no_system__';
  return system.slice(0, 200);
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
  const firstTs = calls[0]?.ts ?? '';
  const lastTs = calls[calls.length - 1]?.ts ?? '';
  const durationMs = calls.length >= 2
    ? new Date(lastTs).getTime() - new Date(firstTs).getTime() + (calls[calls.length - 1]?.duration_ms ?? 0)
    : (calls[0]?.duration_ms ?? 0);
  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    callCount: calls.length,
    firstTs,
    lastTs,
    durationMs,
  };
}

// Extract a human-readable label from system prompt
function extractLabel(system: string | null | undefined, isRoot: boolean): string {
  if (isRoot) return 'main session';
  if (!system) return '(no system prompt)';
  const lines = system.split('\n').map((l: string) => l.trim()).filter(Boolean);
  const label = lines[0] ?? '(subagent)';
  return label.length > 60 ? label.slice(0, 60) + '\u2026' : label;
}

export function buildCallTree(calls: CallRecord[]): ConversationGroup {
  if (calls.length === 0) {
    return {
      id: 'empty',
      systemSnippet: '',
      label: 'empty session',
      calls: [],
      children: [],
      stats: { totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, callCount: 0, firstTs: '', lastTs: '', durationMs: 0 },
    };
  }

  // Step 1: Group calls by system prompt fingerprint
  const groups = new Map<string, CallRecord[]>();
  for (const call of calls) {
    const fp = fingerprint(call.system);
    if (!groups.has(fp)) groups.set(fp, []);
    groups.get(fp)!.push(call);
  }

  // Step 2: Find root group — prefer group containing the very first call
  const firstCallFp = fingerprint(calls[0].system);
  let rootFp = firstCallFp;
  let maxCalls = 0;
  for (const [fp, grpCalls] of groups.entries()) {
    if (grpCalls.length > maxCalls) {
      maxCalls = grpCalls.length;
      rootFp = fp;
    }
  }
  // If tie, prefer the group containing the very first call
  if ((groups.get(firstCallFp)?.length ?? 0) >= (groups.get(rootFp)?.length ?? 0)) {
    rootFp = firstCallFp;
  }

  // Step 3: For each non-root group, find its parent call by timestamp overlap
  const rootCalls = groups.get(rootFp)!;
  const rootCallsSorted = [...rootCalls].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const groupMeta = new Map<string, { parentCallIndex?: number; parentGroupId?: string }>();

  for (const [fp, grpCalls] of groups.entries()) {
    if (fp === rootFp) continue;
    const firstChildTs = new Date(grpCalls[0].ts).getTime();

    // Find the parent call: last root call at or before this child's first call
    let parentCall: CallRecord | undefined;
    for (let i = rootCallsSorted.length - 1; i >= 0; i--) {
      const rc = rootCallsSorted[i];
      if (new Date(rc.ts).getTime() <= firstChildTs) {
        parentCall = rc;
        break;
      }
    }

    if (parentCall) {
      groupMeta.set(fp, { parentCallIndex: parentCall.call_index, parentGroupId: rootFp });
    } else {
      // Orphan — attach to root
      groupMeta.set(fp, {});
    }
  }

  // Step 4: Build ConversationGroup objects
  const groupObjects = new Map<string, ConversationGroup>();

  for (const [fp, grpCalls] of groups.entries()) {
    const isRoot = fp === rootFp;
    const meta = groupMeta.get(fp) ?? {};
    const sortedCalls = [...grpCalls].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    groupObjects.set(fp, {
      id: fp,
      systemSnippet: fp.slice(0, 80),
      label: extractLabel(grpCalls[0].system, isRoot),
      calls: sortedCalls,
      parentCallIndex: meta.parentCallIndex,
      parentGroupId: meta.parentGroupId,
      children: [],
      stats: computeStats(sortedCalls),
    });
  }

  // Step 5: Wire children into parent.children[]
  const root = groupObjects.get(rootFp)!;
  for (const [fp, group] of groupObjects.entries()) {
    if (fp === rootFp) continue;
    const parentFp = group.parentGroupId;
    const parent = parentFp ? groupObjects.get(parentFp) : undefined;
    (parent ?? root).children.push(group);
  }

  // Sort children by firstTs
  function sortChildren(g: ConversationGroup): void {
    g.children.sort((a, b) => new Date(a.stats.firstTs).getTime() - new Date(b.stats.firstTs).getTime());
    g.children.forEach(sortChildren);
  }
  sortChildren(root);

  return root;
}
