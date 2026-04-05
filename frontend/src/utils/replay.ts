import {
  CodeReferenceBlock,
  ContentChunk,
  ConversationReplayData,
  FileBlock,
  Message,
  PlanBlock,
  ReplayContentBlock,
  ReplayPromptEntry,
  RichContentBlock,
  TextBlock,
  ToolCallBlock,
  ToolCallEntry,
  ToolCallEvent,
} from '../types/chat';
import { appendToolOutput, buildToolCallEntry, extractResultTexts, replaceToolOutput, safeParseJson } from './toolCallUtils';

const IMPACTFUL_KEYWORDS = [
  'rm', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown',
  'del', 'erase', 'rd', 'rmdir', 'move', 'copy', 'ren', 'rename',
  'new-item', 'remove-item', 'move-item', 'copy-item',
  'curl', 'wget', 'scp', 'rsync', 'ssh', 'ftp', 'npm', 'yarn', 'git'
];

const REPLAY_IGNORED_USER_COMMAND_TAGS = [
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'local-command-stderr',
];

const REPLAY_IGNORED_USER_COMMAND_PATTERNS = REPLAY_IGNORED_USER_COMMAND_TAGS.map(
  (tag) => new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi')
);
const EDIT_SPLIT_SEPARATOR = '::diff::';

function isExploringTool(kind?: string, title?: string): boolean {
  if (kind === 'read' || kind === 'fetch' || kind === 'search') return true;
  if (kind === 'execute') {
    const cmd = (title || '').toLowerCase().trim();
    if (!cmd) return true;
    const tokens = cmd.split(/[\s"'/\\;|=&]+/);
    const isHighPriority = IMPACTFUL_KEYWORDS.some((keyword) => tokens.includes(keyword));
    return !isHighPriority;
  }
  return false;
}

function codeReferenceText(path: string, startLine?: number, endLine?: number): string {
  if (!startLine || !endLine) return `@${path}`;
  return startLine === endLine
    ? `@${path}#L${startLine}`
    : `@${path}#L${startLine}-${endLine}`;
}

function stripTransferredContextForDisplay(text: string): string {
  const markerStart = text.indexOf('[TRANSFERRED CONTEXT]');
  const markerEnd = text.indexOf('[/TRANSFERRED CONTEXT]');
  if (markerStart < 0 || markerEnd < 0 || markerEnd < markerStart) {
    return text;
  }

  const markerUserRequest = text.indexOf('[USER REQUEST]', markerEnd + '[/TRANSFERRED CONTEXT]'.length);
  if (markerUserRequest < 0) {
    return text;
  }

  return text.slice(markerUserRequest + '[USER REQUEST]'.length).trimStart();
}

function stripReplayCommandMarkup(text: string): string {
  let sanitized = text;
  REPLAY_IGNORED_USER_COMMAND_PATTERNS.forEach((pattern) => {
    sanitized = sanitized.replace(pattern, '');
  });
  return sanitized;
}

function buildSplitToolCallId(toolCallId: string, pathOrIndex: string): string {
  return `${toolCallId}${EDIT_SPLIT_SEPARATOR}${encodeURIComponent(pathOrIndex)}`;
}

function matchesToolCallId(entryId: string, toolCallId: string): boolean {
  return entryId === toolCallId || entryId.startsWith(`${toolCallId}${EDIT_SPLIT_SEPARATOR}`);
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

function createToolCallBlocks(entry: ToolCallEntry): ToolCallBlock[] {
  if (entry.kind !== 'edit' || !Array.isArray(entry.content)) {
    return [{ type: 'tool_call', entry, isReplay: true }];
  }

  const diffs = entry.content
    .filter((item) => item?.type === 'diff' || (item?.path !== undefined && item?.newText !== undefined))
    .map((item) => normalizeDiffEntry(item as Record<string, any>));

  if (diffs.length === 0) {
    return [];
  }

  if (diffs.length === 1) {
    return hasMeaningfulDiff(diffs)
      ? [{ type: 'tool_call', entry: { ...entry, content: diffs }, isReplay: true }]
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
      isReplay: true,
      entry: {
        ...entry,
        toolCallId: buildSplitToolCallId(entry.toolCallId, group.path || `idx-${index}`),
        content: group.diffs,
        locations: matchingLocation ? [matchingLocation] : (group.path ? [{ path: group.path }] : entry.locations),
      }
    };
  });
}

function toUserBlock(block: ReplayContentBlock): RichContentBlock | null {
  const type = block.type || 'text';
  switch (type) {
    case 'text': {
      const text = stripReplayCommandMarkup(stripTransferredContextForDisplay(block.text || ''));
      if (!text.trim()) return null;
      return { type: 'text', text };
    }
    case 'image':
      return { type: 'image', data: block.data || '', mimeType: block.mimeType || '' };
    case 'audio':
      return { type: 'audio', data: block.data || '', mimeType: block.mimeType || '' };
    case 'video':
      return { type: 'video', data: block.data || '', mimeType: block.mimeType || '' };
    case 'file':
      return {
        type: 'file',
        name: block.name || 'file',
        mimeType: block.mimeType || 'application/octet-stream',
        data: block.data,
        path: block.path,
      } as FileBlock;
    case 'code_ref':
      return {
        type: 'code_ref',
        name: block.name || block.path || 'reference',
        path: block.path || '',
        startLine: block.startLine,
        endLine: block.endLine,
      } as CodeReferenceBlock;
    default: {
      const text = stripReplayCommandMarkup(stripTransferredContextForDisplay(block.text || ''));
      if (!text.trim()) return null;
      return { type: 'text', text };
    }
  }
}

function userContentFromBlocks(blocks: RichContentBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'code_ref') return codeReferenceText(block.path, block.startLine, block.endLine);
    return '';
  }).join('');
}

function buildChunkFromReplayEvent(event: ReplayContentBlock): ContentChunk | null {
  const type = event.type || 'text';
  if (type !== 'text' &&
      type !== 'thinking' &&
      type !== 'image' &&
      type !== 'audio' &&
      type !== 'video' &&
      type !== 'file' &&
      type !== 'tool_call' &&
      type !== 'tool_call_update' &&
      type !== 'plan') {
    return null;
  }
  return {
    chatId: '',
    role: event.role === 'user' ? 'user' : 'assistant',
    type,
    text: event.text,
    data: event.data,
    path: event.path,
    name: event.name,
    mimeType: event.mimeType,
    isReplay: true,
    toolCallId: event.toolCallId,
    toolKind: event.toolKind,
    toolTitle: event.toolTitle,
    toolStatus: event.toolStatus,
    toolRawJson: event.toolRawJson,
    planEntries: event.planEntries,
  };
}

function closeStreamingExploring(blocks: RichContentBlock[]) {
  if (blocks.length === 0) return;
  const last = blocks[blocks.length - 1];
  if (last.type === 'exploring' && last.isStreaming) {
    blocks[blocks.length - 1] = { ...last, isStreaming: false };
  }
}

function applyToolCall(blocks: RichContentBlock[], chunk: ContentChunk, replayKeyPrefix: string) {
  const entry = buildToolCallEntry(chunk);
  const exploring = isExploringTool(entry.kind, entry.title);
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;

  if (!exploring) {
    closeStreamingExploring(blocks);
    const replacements = createToolCallBlocks(entry);
    const matchingIndexes = blocks
      .map((block, index) => block.type === 'tool_call' && matchesToolCallId((block as ToolCallBlock).entry.toolCallId, entry.toolCallId) ? index : -1)
      .filter((index) => index >= 0);
    if (matchingIndexes.length > 0) {
      const existingBlocks = matchingIndexes.map((index) => blocks[index] as ToolCallBlock);
      const mergedBlocks = replacements.map((replacement, index) => {
        const existing = existingBlocks[index]?.entry;
        if (!existing) return replacement;
        return {
          ...replacement,
          entry: {
            ...existing,
            ...replacement.entry,
            title: replacement.entry.title || existing.title,
            kind: replacement.entry.kind || existing.kind,
            status: replacement.entry.status || existing.status,
            rawJson: replacement.entry.rawJson || existing.rawJson,
            locations: replacement.entry.locations || existing.locations,
            content: replacement.entry.content || existing.content,
            result: replacement.entry.result || existing.result,
          }
        } as ToolCallBlock;
      });
      blocks.splice(matchingIndexes[0], matchingIndexes.length, ...mergedBlocks);
      return;
    }
    blocks.push(...replacements);
    return;
  }

  if (lastBlock && lastBlock.type === 'exploring') {
    const entries = [...lastBlock.entries];
    const idx = entries.findIndex((item) => item.toolCallId === entry.toolCallId);
    if (idx >= 0) {
      entries[idx] = entry;
    } else {
      entries.push(entry);
    }
    blocks[blocks.length - 1] = { ...lastBlock, entries, isReplay: true, isStreaming: false };
    return;
  }

  blocks.push({
    type: 'exploring',
    isReplay: true,
    isStreaming: false,
    entries: [{ ...entry, toolCallId: entry.toolCallId || `${replayKeyPrefix}-tool-${blocks.length}` }],
  });
}

function applyToolCallUpdate(blocks: RichContentBlock[], chunk: ContentChunk) {
  const toolCallId = chunk.toolCallId;
  if (!toolCallId) return;

  const json = safeParseJson(chunk.toolRawJson);
  const nextTitle = chunk.toolTitle || json.title;
  const nextKind = chunk.toolKind || json.kind;
  const nextStatus = chunk.toolStatus || json.status;
  const nextContent = json.content || json.diff;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === 'tool_call' && matchesToolCallId(block.entry.toolCallId, toolCallId)) {
      const matchingIndexes = blocks
        .map((item, index) => item.type === 'tool_call' && matchesToolCallId((item as ToolCallBlock).entry.toolCallId, toolCallId) ? index : -1)
        .filter((index) => index >= 0);
      const updatedBaseEntry: ToolCallEntry = {
        ...buildToolCallEntry(chunk),
        status: nextStatus || block.entry.status,
        title: nextTitle || block.entry.title,
        kind: nextKind || block.entry.kind,
        rawJson: chunk.toolRawJson || block.entry.rawJson,
        locations: json.locations || block.entry.locations,
        content: nextContent || block.entry.content,
      };
      const currentKind = updatedBaseEntry.kind || block.entry.kind || json.kind;
      const resultText = extractResultTexts(json);
      if (resultText) {
        updatedBaseEntry.result = appendToolOutput(updatedBaseEntry.result, resultText, undefined, currentKind).text;
      }
      const replacements = createToolCallBlocks(updatedBaseEntry);
      const existingBlocks = matchingIndexes.map((index) => blocks[index] as ToolCallBlock);
      const mergedBlocks = replacements.map((replacement, index) => {
        const existing = existingBlocks[index]?.entry;
        if (!existing) return replacement;
        return {
          ...replacement,
          entry: {
            ...existing,
            ...replacement.entry,
            result: replacement.entry.result || existing.result,
          }
        } as ToolCallBlock;
      });
      blocks.splice(matchingIndexes[0], matchingIndexes.length, ...mergedBlocks);
      return;
    }
    if (block.type === 'exploring') {
      const idx = block.entries.findIndex((entry) => entry.toolCallId === toolCallId);
      if (idx >= 0) {
        const entries = [...block.entries];
        const entry = { ...entries[idx] };
        if (nextStatus) entry.status = nextStatus;
        if (nextTitle) entry.title = nextTitle;
        if (nextKind) entry.kind = nextKind;
        if (chunk.toolRawJson) entry.rawJson = chunk.toolRawJson;
        if (json.locations) entry.locations = json.locations;
        if (nextContent) entry.content = nextContent;
        const currentKind = nextKind || entry.kind || json.kind;
        const resultText = extractResultTexts(json);
        if (resultText) {
          entry.result = appendToolOutput(entry.result, resultText, undefined, currentKind).text;
        }
        entries[idx] = entry;
        blocks[i] = { ...block, entries };
        return;
      }
    }
  }

  const entry = buildToolCallEntry(chunk);
  const resultText = extractResultTexts(json);
  if (resultText) {
    entry.result = replaceToolOutput(resultText, undefined, entry.kind || json.kind).text;
  }
  blocks.push(...createToolCallBlocks(entry));
}

function buildAssistantMessage(prompt: ReplayPromptEntry, sessionIndex: number, promptIndex: number): Message | null {
  const blocks: RichContentBlock[] = [];
  let thinkingCounter = 0;

  (prompt.events || []).forEach((event) => {
    const chunk = buildChunkFromReplayEvent(event);
    if (!chunk || chunk.role !== 'assistant') return;
    switch (chunk.type) {
      case 'text': {
        const text = chunk.text || '';
        if (!text) return;
        closeStreamingExploring(blocks);
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'text') {
          blocks[blocks.length - 1] = { ...last, text: last.text + text };
        } else {
          blocks.push({ type: 'text', text });
        }
        break;
      }
      case 'thinking': {
        const text = chunk.text || '';
        if (!text) return;
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'exploring') {
          const entries = [...last.entries];
          const lastEntry = entries[entries.length - 1];
          if (lastEntry && lastEntry.kind === 'thinking') {
            entries[entries.length - 1] = { ...lastEntry, text: (lastEntry.text || '') + text };
          } else {
            entries.push({
              toolCallId: `replay-thinking-${sessionIndex}-${promptIndex}-${++thinkingCounter}`,
              kind: 'thinking',
              text,
              rawJson: '',
            });
          }
          blocks[blocks.length - 1] = { ...last, entries, isReplay: true, isStreaming: false };
        } else {
          closeStreamingExploring(blocks);
          blocks.push({
            type: 'exploring',
            isReplay: true,
            isStreaming: false,
            entries: [{
              toolCallId: `replay-thinking-${sessionIndex}-${promptIndex}-${++thinkingCounter}`,
              kind: 'thinking',
              text,
              rawJson: '',
            }]
          });
        }
        break;
      }
      case 'image':
        blocks.push({ type: 'image', data: chunk.data || '', mimeType: chunk.mimeType || '' });
        break;
      case 'audio':
        blocks.push({ type: 'audio', data: chunk.data || '', mimeType: chunk.mimeType || '' });
        break;
      case 'video':
        blocks.push({ type: 'video', data: chunk.data || '', mimeType: chunk.mimeType || '' });
        break;
      case 'file':
        blocks.push({
          type: 'file',
          name: chunk.name || 'file',
          mimeType: chunk.mimeType || 'application/octet-stream',
          data: chunk.data,
          path: chunk.path,
        });
        break;
      case 'tool_call':
        applyToolCall(blocks, chunk, `replay-${sessionIndex}-${promptIndex}`);
        break;
      case 'tool_call_update':
        applyToolCallUpdate(blocks, chunk);
        break;
      case 'plan':
        closeStreamingExploring(blocks);
        blocks.push({ type: 'plan', entries: chunk.planEntries || [], isReplay: true } as PlanBlock);
        break;
    }
  });

  const meta = prompt.assistantMeta;
  if (blocks.length === 0 && !meta) return null;

  return {
    id: `replay-assistant-${sessionIndex}-${promptIndex}`,
    role: 'assistant',
    content: blocks.filter((block): block is TextBlock => block.type === 'text').map((block) => block.text).join(''),
    contentBlocks: blocks,
    agentId: meta?.agentId,
    agentName: meta?.agentName,
    modelName: meta?.modelName,
    modeName: meta?.modeName,
    promptStartedAtMillis: meta?.promptStartedAtMillis,
    duration: meta?.durationSeconds,
    contextTokensUsed: meta?.contextTokensUsed,
    contextWindowSize: meta?.contextWindowSize,
    metaComplete: Boolean(meta),
  };
}

export function buildReplayMessages(data: ConversationReplayData): Message[] {
  const messages: Message[] = [];
  (data.sessions || []).forEach((session, sessionIndex) => {
    (session.prompts || []).forEach((prompt, promptIndex) => {
      const userBlocks = (prompt.blocks || [])
        .map(toUserBlock)
        .filter((block): block is RichContentBlock => block !== null);
      if (userBlocks.length > 0) {
        messages.push({
          id: `replay-user-${sessionIndex}-${promptIndex}`,
          role: 'user',
          content: userContentFromBlocks(userBlocks),
          blocks: userBlocks,
        });
      }
      const assistantMessage = buildAssistantMessage(prompt, sessionIndex, promptIndex);
      if (assistantMessage) {
        messages.push(assistantMessage);
      }
    });
  });
  return messages;
}

function extractToolCallPayload(event: ReplayContentBlock): ToolCallEvent | null {
  const type = event.type || '';
  if (type !== 'tool_call' && type !== 'tool_call_update') return null;
  const raw = safeParseJson(event.toolRawJson);
  const diffs = Array.isArray(raw.content)
    ? raw.content
        .filter((item: any) => item.type === 'diff' || (item.path !== undefined && item.newText !== undefined))
        .map((item: any) => ({ path: item.path, oldText: item.oldText ?? null, newText: item.newText ?? '' }))
    : (Array.isArray(raw.diffs) ? raw.diffs : []);

  if (diffs.length > 0) {
    return {
      toolCallId: event.toolCallId || raw.toolCallId || '',
      title: event.toolTitle || raw.title || '',
      kind: event.toolKind || raw.kind,
      status: event.toolStatus || raw.status,
      isReplay: true,
      diffs,
      locations: raw.locations,
    };
  }

  if (type === 'tool_call_update' && (event.toolCallId || raw.toolCallId) && (event.toolStatus || raw.status)) {
    return {
      toolCallId: event.toolCallId || raw.toolCallId || '',
      title: event.toolTitle || raw.title || '',
      kind: event.toolKind || raw.kind,
      status: event.toolStatus || raw.status,
      isReplay: true,
      diffs: [],
    };
  }

  return null;
}

export function buildReplayToolCallEvents(data: ConversationReplayData): ToolCallEvent[] {
  const toolCallEvents: ToolCallEvent[] = [];
  (data.sessions || []).forEach((session) => {
    (session.prompts || []).forEach((prompt) => {
      (prompt.events || []).forEach((event) => {
        const type = event.type || '';
        const payload = extractToolCallPayload(event);
        if (!payload) return;
        const hasDiffs = payload.diffs.length > 0;
        if (type === 'tool_call') {
          if (hasDiffs) {
            toolCallEvents.push(payload);
          }
          return;
        }
        if (hasDiffs) {
          const existingIdx = toolCallEvents.findIndex((item) => item.toolCallId === payload.toolCallId);
          if (existingIdx >= 0) {
            toolCallEvents[existingIdx] = payload;
          } else {
            toolCallEvents.push(payload);
          }
        } else if (payload.toolCallId && payload.status) {
          const existingIdx = toolCallEvents.findIndex((item) => item.toolCallId === payload.toolCallId);
          if (existingIdx >= 0) {
            toolCallEvents[existingIdx] = { ...toolCallEvents[existingIdx], status: payload.status };
          }
        }
      });
    });
  });
  return toolCallEvents;
}
