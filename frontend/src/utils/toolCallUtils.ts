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

function stripExecuteMarkdown(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const withoutFences = lines.filter((line, index) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('```')) return true;
    return index !== 0 && index !== lines.length - 1;
  }).join('\n');
  return withoutFences.replace(/```+/g, '').replace(/`/g, '').trim();
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
  if (texts.length === 0) return undefined;
  return texts.join('\n\n');
}

const MAX_TOOL_OUTPUT_LINES = 200;

export function truncateToolOutput(text: string, maxLines: number = MAX_TOOL_OUTPUT_LINES): { text: string; truncated: boolean; originalLength: number } {
  const lines = text.split(/\r\n|\n|\r/);
  const originalLength = lines.length;
  if (originalLength <= maxLines) return { text, truncated: false, originalLength };
  const head = lines.slice(0, maxLines).join('\n');
  const omitted = originalLength - maxLines;
  const suffix = `\n\n[Output truncated to ${maxLines} lines; ${omitted} lines omitted]`;
  return { text: head + suffix, truncated: true, originalLength };
}

export function truncateToolOutputForKind(text: string, kind?: string, maxLines: number = MAX_TOOL_OUTPUT_LINES): { text: string; truncated: boolean; originalLength: number } {
  if ((kind || '').toLowerCase() !== 'execute') {
    return truncateToolOutput(text, maxLines);
  }

  const originalLines = text.split(/\r\n|\n|\r/);
  if (originalLines.length <= maxLines) {
    return { text, truncated: false, originalLength: originalLines.length };
  }

  return truncateToolOutput(stripExecuteMarkdown(text), maxLines);
}

export function appendToolOutput(prev: string | undefined, next: string, maxLines: number = MAX_TOOL_OUTPUT_LINES, kind?: string): { text: string; truncated: boolean; originalLength: number } {
  const combined = prev ? `${prev}\n\n${next}` : next;
  return truncateToolOutputForKind(combined, kind, maxLines);
}

export function replaceToolOutput(next: string, maxLines: number = MAX_TOOL_OUTPUT_LINES, kind?: string): { text: string; truncated: boolean; originalLength: number } {
  return truncateToolOutputForKind(next, kind, maxLines);
}
