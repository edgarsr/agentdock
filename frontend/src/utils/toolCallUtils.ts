import { ToolCallEntry, ContentChunk, ToolCallDiffEntry } from '../types/chat';

export type { ToolCallDiffEntry };

export interface ToolCallStatus {
  isPending: boolean;
  isError: boolean;
  isFinished: boolean;
}

export function parseToolStatus(rawStatus?: string): ToolCallStatus {
  const status = (rawStatus || 'pending').toLowerCase();
  const isPending = status === 'pending' || status === 'running' || status === 'in_progress' || status === 'active';
  const isError = status === 'error' || status === 'failed';
  const isFinished = status === 'success' || status === 'completed' || isError;
  return { isPending, isError, isFinished };
}

export function safeParseJson(json: string | undefined): Record<string, any> {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function buildToolCallEntry(chunk: ContentChunk): ToolCallEntry {
  const json = safeParseJson(chunk.toolRawJson);
  const kind = chunk.toolKind || json.kind;
  const resultText = extractResultTexts(json);
  return {
    toolCallId: chunk.toolCallId || '',
    title: chunk.toolTitle || json.title,
    kind,
    status: chunk.toolStatus || json.status,
    rawJson: chunk.toolRawJson || '',
    locations: json.locations,
    content: json.content || json.diff,
    result: resultText ? truncateToolOutputForKind(resultText, kind).text : undefined,
  };
}

export function extractToolCallDiffEntries(
  json: Record<string, any>,
  fallbackRawInput?: Record<string, any>
): ToolCallDiffEntry[] {
  const structuredDiffs = Array.isArray(json.content)
    ? json.content
        .filter((item: any) => item?.type === 'diff' || (item?.path !== undefined && item?.newText !== undefined))
        .map((item: any) => ({
          type: 'diff' as const,
          path: typeof item.path === 'string' ? item.path : '',
          oldText: item.oldText ?? null,
          newText: item.newText ?? '',
        }))
    : (Array.isArray(json.diffs)
        ? json.diffs.map((item: any) => ({
            type: 'diff' as const,
            path: typeof item.path === 'string' ? item.path : '',
            oldText: item.oldText ?? null,
            newText: item.newText ?? '',
          }))
        : []);

  if (structuredDiffs.length > 0) {
    return structuredDiffs;
  }

  const rawInput = (json.rawInput && typeof json.rawInput === 'object' ? json.rawInput : fallbackRawInput) as Record<string, any> | undefined;
  if (!rawInput || typeof rawInput.path !== 'string' || rawInput.path.length === 0 || rawInput.file_text === undefined) {
    return [];
  }

  return [{
    type: 'diff',
    path: rawInput.path,
    oldText: null,
    newText: typeof rawInput.file_text === 'string' ? rawInput.file_text : String(rawInput.file_text),
  }];
}

function isExecutePermissionPayload(json: Record<string, any>): boolean {
  if ((json.kind || '').toLowerCase() !== 'execute') return false;
  const rawInput = json.rawInput;
  if (!rawInput || typeof rawInput !== 'object') return false;
  return Array.isArray(rawInput.available_decisions)
    || Array.isArray(rawInput.proposed_execpolicy_amendment)
    || typeof rawInput.reason === 'string';
}

export function extractResultTexts(json: Record<string, any>): string | undefined {
  if (isExecutePermissionPayload(json)) {
    return undefined;
  }

  const texts: string[] = [];
  if (Array.isArray(json.content)) {
    for (const c of json.content) {
      const t = c.text || c.content?.text;
      if (t && typeof t === 'string') texts.push(t);
    }
  } else if (json.text) {
    texts.push(json.text);
  }
  if (texts.length === 0) {
    const msg = json.rawOutput?.message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
    const rawContent = json.rawOutput?.content;
    if (typeof rawContent === 'string' && rawContent.trim()) return rawContent.trim();
    return undefined;
  }
  return texts.join('\n\n');
}

const MAX_TOOL_OUTPUT_LINES = 600;
const MAX_TOOL_OUTPUT_CHARS = 10000;

function buildToolOutputRemovedNotice(removedCharacters: number): string {
  return `[Output removed: ${removedCharacters} characters]`;
}

export function truncateToolOutputForKind(text: string, kind?: string): { text: string; truncated: boolean; originalLength: number } {
  const originalLength = text.split(/\r\n|\n|\r/).length;
  if ((kind || '').toLowerCase() === 'edit') {
    return { text, truncated: false, originalLength };
  }
  if (originalLength > MAX_TOOL_OUTPUT_LINES || text.length > MAX_TOOL_OUTPUT_CHARS) {
    return { text: buildToolOutputRemovedNotice(text.length), truncated: true, originalLength };
  }
  return { text, truncated: false, originalLength };
}

export function appendToolOutput(prev: string | undefined, next: string, _maxLines?: number, kind?: string): { text: string; truncated: boolean; originalLength: number } {
  const combined = prev ? `${prev}\n\n${next}` : next;
  return truncateToolOutputForKind(combined, kind);
}

export function replaceToolOutput(next: string, _maxLines?: number, kind?: string): { text: string; truncated: boolean; originalLength: number } {
  return truncateToolOutputForKind(next, kind);
}
