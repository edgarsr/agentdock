import { ToolCallEntry, ContentChunk } from '../types/chat';

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
  return {
    toolCallId: chunk.toolCallId || '',
    title: chunk.toolTitle || json.title,
    kind: chunk.toolKind,
    status: chunk.toolStatus || json.status,
    rawJson: chunk.toolRawJson || '',
    locations: json.locations,
    content: json.content || json.diff,
  };
}

export function extractResultTexts(json: Record<string, any>): string | undefined {
  const texts: string[] = [];
  if (Array.isArray(json.content)) {
    for (const c of json.content) {
      const t = c.text || c.content?.text;
      if (t && typeof t === 'string') texts.push(t);
    }
  } else if (json.text) {
    texts.push(json.text);
  }
  return texts.length > 0 ? texts.join('\n\n') : undefined;
}

const MAX_TOOL_OUTPUT_CHARS = 20000;

export function truncateToolOutput(text: string, maxChars: number = MAX_TOOL_OUTPUT_CHARS): { text: string; truncated: boolean; originalLength: number } {
  const originalLength = text.length;
  if (originalLength <= maxChars) return { text, truncated: false, originalLength };
  const head = text.slice(0, maxChars);
  const omitted = originalLength - maxChars;
  const suffix = `\n\n[Output truncated to ${maxChars} chars; ${omitted} chars omitted]`;
  return { text: head + suffix, truncated: true, originalLength };
}

export function appendToolOutput(prev: string | undefined, next: string, maxChars: number = MAX_TOOL_OUTPUT_CHARS): { text: string; truncated: boolean; originalLength: number } {
  const combined = prev ? `${prev}\n\n${next}` : next;
  return truncateToolOutput(combined, maxChars);
}
