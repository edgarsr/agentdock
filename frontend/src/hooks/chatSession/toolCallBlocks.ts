import { ToolCallBlock, ToolCallEntry } from '../../types/chat';

const EDIT_SPLIT_SEPARATOR = '::diff::';

function buildSplitToolCallId(toolCallId: string, pathOrIndex: string): string {
  return `${toolCallId}${EDIT_SPLIT_SEPARATOR}${encodeURIComponent(pathOrIndex)}`;
}

export function matchesToolCallId(entryId: string, toolCallId: string): boolean {
  return entryId === toolCallId || entryId.startsWith(`${toolCallId}${EDIT_SPLIT_SEPARATOR}`);
}

export function isExecuteToolKind(kind?: string): boolean {
  return (kind || '').toLowerCase() === 'execute';
}

function normalizeDiffEntry(item: Record<string, any>) {
  const path = typeof item.path === 'string' ? item.path : '';
  const oldText = item.oldText ?? null;
  const newText = item.newText ?? '';
  return {
    ...item,
    type: 'diff',
    path,
    oldText,
    newText,
  };
}

function hasMeaningfulDiff(entries: Record<string, any>[]): boolean {
  if (entries.length === 0) return false;
  const normalizeLineEndings = (text: string) => text.replace(/\r\n?/g, '\n');
  const first = entries[0];
  const last = entries[entries.length - 1];
  const oldText = normalizeLineEndings(first.oldText ?? '');
  const newText = normalizeLineEndings(last.newText ?? '');
  return oldText !== newText;
}

export function createToolCallBlocks(entry: ToolCallEntry, isReplay?: boolean): ToolCallBlock[] {
  if (entry.kind !== 'edit') {
    return [{ type: 'tool_call', entry, isReplay } as ToolCallBlock];
  }
  if (!Array.isArray(entry.content)) {
    // Keep the initial call visible and available for a subsequent tool_call_update.
    return [{ type: 'tool_call', entry, isReplay } as ToolCallBlock];
  }

  const diffs = entry.content
    .filter((item) => item?.type === 'diff' || (item?.path !== undefined && item?.newText !== undefined))
    .map((item) => normalizeDiffEntry(item as Record<string, any>));

  if (diffs.length === 0) {
    return [];
  }

  if (diffs.length === 1) {
    return hasMeaningfulDiff(diffs)
      ? [{ type: 'tool_call', entry: { ...entry, content: diffs }, isReplay } as ToolCallBlock]
      : [];
  }

  const groupedDiffs = new Map<string, { path?: string; diffs: Record<string, any>[] }>();
  diffs.forEach((diff, index) => {
    const diffPath = diff.path || undefined;
    const key = diffPath || `idx-${index}`;
    const existing = groupedDiffs.get(key);
    if (existing) {
      existing.diffs.push(diff);
      return;
    }
    groupedDiffs.set(key, { path: diffPath, diffs: [diff] });
  });

  return Array.from(groupedDiffs.values()).flatMap((group, index) => {
    if (!hasMeaningfulDiff(group.diffs)) return [];
    const matchingLocation = group.path ? entry.locations?.find((location) => location.path === group.path) : undefined;
    return {
      type: 'tool_call',
      isReplay,
      entry: {
        ...entry,
        toolCallId: buildSplitToolCallId(entry.toolCallId, group.path || `idx-${index}`),
        content: group.diffs,
        locations: matchingLocation ? [matchingLocation] : (group.path ? [{ path: group.path }] : entry.locations),
      }
    } as ToolCallBlock;
  });
}
