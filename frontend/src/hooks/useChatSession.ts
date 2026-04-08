import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Message,
  AgentOption,
  PermissionRequest,
  DropdownOption,
  HistorySessionMeta,
  ChatAttachment,
  PendingHandoffContext,
  RichContentBlock,
  TextBlock,
  ExploringBlock,
  ToolCallBlock,
  ToolCallEntry,
  ContentChunk,
  AvailableCommand
} from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import { safeParseJson, buildToolCallEntry, extractResultTexts, appendToolOutput, replaceToolOutput, extractToolCallDiffEntries } from '../utils/toolCallUtils';
import { buildConversationHandoffPromptPrefix } from '../utils/conversationHandoff';
import { buildReplayMessages } from '../utils/replay';

function isExploringChunk(chunk: ContentChunk): boolean {
  const kind = chunk.toolKind || '';
  if (kind === 'read' || kind === 'fetch' || kind === 'search') return true;
  if (kind === 'execute') {
    const cmd = (chunk.toolTitle || '').toLowerCase().trim();
    if (!cmd) return true;

    const IMPACTFUL_KEYWORDS = [
      'rm', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown',
      'del', 'erase', 'rd', 'rmdir', 'move', 'copy', 'ren', 'rename',
      'new-item', 'remove-item', 'move-item', 'copy-item',
      'curl', 'wget', 'scp', 'rsync', 'ssh', 'ftp', 'npm', 'yarn', 'git'
    ];

    const tokens = cmd.split(/[\s"'/\\;|=&]+/);
    const isHighPriority = IMPACTFUL_KEYWORDS.some(kw => tokens.includes(kw));
    
    return !isHighPriority;
  }
  return false;
}

let messageCounter = 0;
let thinkingCounter = 0;
const EDIT_SPLIT_SEPARATOR = '::diff::';
function nextMessageId(suffix: string): string {
  return `msg-${++messageCounter}-${Date.now()}-${suffix}`;
}

function codeReferenceText(path: string, startLine?: number, endLine?: number): string {
  if (!startLine || !endLine) return `@${path}`;
  return startLine === endLine
    ? `@${path}#L${startLine}`
    : `@${path}#L${startLine}-${endLine}`;
}

function plainTextFromBlocks(blocks: any[]): string {
  return blocks.map((block) => {
    if (block.type === 'text') return block.text || '';
    if (block.type === 'code_ref') return codeReferenceText(block.path, block.startLine, block.endLine);
    return '';
  }).join('');
}

function buildSplitToolCallId(toolCallId: string, pathOrIndex: string): string {
  return `${toolCallId}${EDIT_SPLIT_SEPARATOR}${encodeURIComponent(pathOrIndex)}`;
}

function matchesToolCallId(entryId: string, toolCallId: string): boolean {
  return entryId === toolCallId || entryId.startsWith(`${toolCallId}${EDIT_SPLIT_SEPARATOR}`);
}

function isExecuteToolKind(kind?: string): boolean {
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

function createToolCallBlocks(entry: ToolCallEntry, isReplay: boolean): ToolCallBlock[] {
  if (entry.kind !== 'edit') {
    return [{ type: 'tool_call', entry, isReplay } as ToolCallBlock];
  }
  if (!Array.isArray(entry.content)) {
    // Return a placeholder block so that subsequent tool_call_update chunks
    // can locate it by toolCallId and fill in the diff content.
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

function titleFromFirstPrompt(messages: Message[]): string | undefined {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const raw = firstUserMessage?.content?.replace(/\s+/g, ' ').trim() || '';
  if (!raw) return undefined;
  if (raw.length <= 64) return raw;
  return `${raw.slice(0, 64)}...`;
}

function normalizeOutgoingBlocks(blocks: any[]): any[] {
  return blocks.filter((block) => {
    if (!block) return false;
    if (block.type === 'text') {
      return typeof block.text === 'string' && block.text.length > 0;
    }
    if (block.type === 'code_ref') {
      return typeof block.path === 'string' && block.path.length > 0;
    }
    return true;
  }).map((block) => {
    if (block.type === 'code_ref') {
      return {
        ...block,
        text: codeReferenceText(block.path, block.startLine, block.endLine),
      };
    }
    return block;
  });
}

function prependHandoffContext(blocks: any[], handoffText: string): any[] {
  const prefix = buildConversationHandoffPromptPrefix(handoffText);
  if (!prefix) return blocks;
  return [
    { type: 'text', text: `${prefix}\n\n` },
    ...blocks,
  ];
}

function stripTransferredContextForDisplay(text: string, role: 'user' | 'assistant', isReplay: boolean): string {
  if (!isReplay || role !== 'user') return text;

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

// ---------------------------------------------------------------------------
// Unified chunk processing - THE SINGLE code path for both streaming and replay.
// Each chunk is { role, type, text?, data?, mimeType?, isReplay }.
// ---------------------------------------------------------------------------

function getBlocks(msg: Message): RichContentBlock[] {
  return msg.role === 'assistant'
    ? [...(msg.contentBlocks || [])]
    : [...(msg.blocks || [])];
}

function setBlocks(msg: Message, blocks: RichContentBlock[]): Message {
  if (msg.role === 'assistant') {
    return { ...msg, contentBlocks: [...blocks] };
  } else {
    return { ...msg, blocks: [...blocks] };
  }
}

function failPendingToolStatuses(blocks: RichContentBlock[] | undefined): RichContentBlock[] | undefined {
  if (!blocks) return blocks;

  let changed = false;
  const nextBlocks = blocks.map((block) => {
    if (block.type === 'tool_call') {
      const status = (block.entry.status || '').toLowerCase();
      if (!status || status === 'pending' || status === 'running' || status === 'in_progress' || status === 'active') {
        changed = true;
        return {
          ...block,
          entry: {
            ...block.entry,
            status: 'failed',
          }
        };
      }
      return block;
    }

    if (block.type === 'exploring') {
      let entriesChanged = false;
      const entries = block.entries.map((entry) => {
        const status = (entry.status || '').toLowerCase();
        if (!status || status === 'pending' || status === 'running' || status === 'in_progress' || status === 'active') {
          entriesChanged = true;
          return { ...entry, status: 'failed' };
        }
        return entry;
      });

      if (entriesChanged) {
        changed = true;
        return { ...block, entries };
      }
    }

    return block;
  });

  return changed ? nextBlocks : blocks;
}

function applyPromptDone(messages: Message[], chunk: ContentChunk): Message[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;

    const next = [...messages];
    const finalizedMessage: Message = {
      ...message,
      agentId: chunk.agentId ?? message.agentId,
      agentName: chunk.agentName ?? message.agentName,
      modelName: chunk.modelName ?? message.modelName,
      modeName: chunk.modeName ?? message.modeName,
      promptStartedAtMillis: chunk.promptStartedAtMillis ?? message.promptStartedAtMillis,
      duration: chunk.durationSeconds ?? message.duration,
      contextTokensUsed: chunk.contextTokensUsed ?? message.contextTokensUsed,
      contextWindowSize: chunk.contextWindowSize ?? message.contextWindowSize,
      contentBlocks: failPendingToolStatuses(message.contentBlocks),
      metaComplete: true,
    };
    next[i] = finalizedMessage;
    return next;
  }

  return messages;
}

function applyOneChunk(messages: Message[], chunk: ContentChunk): Message[] {
  if (chunk.type === 'prompt_done') {
    return applyPromptDone(messages, chunk);
  }

  const displayText = (chunk.type === 'text' || chunk.type === 'thinking')
    ? stripTransferredContextForDisplay(chunk.text || '', chunk.role, chunk.isReplay)
    : chunk.text;

  // Skip empty text/thinking chunks
  if ((chunk.type === 'text' || chunk.type === 'thinking') && !displayText) return messages;

  const newMessages = [...messages];
  let lastMsg = newMessages.length > 0 ? { ...newMessages[newMessages.length - 1] } : null;

  // ------ Create new message if role differs or no messages yet ------
  if (!lastMsg || lastMsg.role !== chunk.role) {
    const blocks = buildBlocks({ ...chunk, text: displayText });
    const newMsg: Message = {
      id: nextMessageId(chunk.role),
      role: chunk.role,
      content: chunk.type === 'text' ? (displayText || '') : '',
      timestamp: chunk.isReplay ? undefined : Date.now()
    };
    if (chunk.role === 'assistant') {
      newMsg.contentBlocks = blocks;
    } else {
      newMsg.blocks = blocks;
    }
    newMessages.push(newMsg);
    return newMessages;
  }

  // ------ Same role - merge into existing message ------
  const blocks = getBlocks(lastMsg);
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;

  if (chunk.type === 'text') {
    closeStreamingExploring(blocks);

    if (lastBlock && lastBlock.type === 'text') {
      blocks[blocks.length - 1] = { ...lastBlock, text: (lastBlock as TextBlock).text + (displayText || '') };
    } else {
      blocks.push({ type: 'text', text: displayText || '' });
    }
  } else if (chunk.type === 'thinking') {
    // Convert thinking to exploring entry
    if (lastBlock && lastBlock.type === 'exploring' && (lastBlock.isStreaming || chunk.isReplay)) {
      const exploring = lastBlock as ExploringBlock;
      const prevEntries = [...exploring.entries];
      const lastEntry = prevEntries[prevEntries.length - 1];

      // If last entry is thinking, append to it
      if (lastEntry && lastEntry.kind === 'thinking') {
        const existingText = lastEntry.text || '';
        prevEntries[prevEntries.length - 1] = {
          ...lastEntry,
          text: existingText + (displayText || '')
        };
      } else {
        // Add new thinking entry
        prevEntries.push({
          toolCallId: `thinking-${++thinkingCounter}`,
          kind: 'thinking',
          text: displayText || '',
          rawJson: ''
        });
      }
      blocks[blocks.length - 1] = { ...exploring, entries: prevEntries };
    } else {
      // Create new exploring block with thinking entry
      closeStreamingExploring(blocks);
      blocks.push({
        type: 'exploring',
        isStreaming: !chunk.isReplay,
        isReplay: chunk.isReplay,
        entries: [{
          toolCallId: `thinking-${++thinkingCounter}`,
          kind: 'thinking',
          text: displayText || '',
          rawJson: ''
        }]
      });
    }
  } else if (chunk.type === 'image') {
    blocks.push({ type: 'image', data: chunk.data!, mimeType: chunk.mimeType! } as any);
  } else if (chunk.type === 'audio') {
    blocks.push({ type: 'audio', data: chunk.data!, mimeType: chunk.mimeType! } as any);
  } else if (chunk.type === 'video') {
    blocks.push({ type: 'video', data: chunk.data!, mimeType: chunk.mimeType! } as any);
  } else if (chunk.type === 'tool_call') {
    handleToolCall(blocks, lastBlock, chunk);
  } else if (chunk.type === 'tool_call_update') {
    handleToolCallUpdate(blocks, chunk);
  } else if (chunk.type === 'plan') {
    closeStreamingExploring(blocks);
    blocks.push({ type: 'plan', entries: chunk.planEntries || [], isReplay: chunk.isReplay });
  }

  // Final rebuild
  const txt = blocks.filter((b): b is TextBlock => b.type === 'text').map(b => b.text).join('');
  const finalMsg = setBlocks({ ...lastMsg, content: txt }, blocks);
  newMessages[newMessages.length - 1] = finalMsg;
  return newMessages;
}

function buildBlocks(chunk: ContentChunk): RichContentBlock[] {
  switch (chunk.type) {
    case 'thinking':
      return [{
        type: 'exploring',
        isStreaming: !chunk.isReplay,
        isReplay: chunk.isReplay,
        entries: [{
          toolCallId: `thinking-${++thinkingCounter}`,
          kind: 'thinking',
          text: chunk.text || '',
          rawJson: ''
        }]
      }];
    case 'image':
      return [{ type: 'image', data: chunk.data!, mimeType: chunk.mimeType! } as any];
    case 'audio':
      return [{ type: 'audio', data: chunk.data!, mimeType: chunk.mimeType! } as any];
    case 'video':
      return [{ type: 'video', data: chunk.data!, mimeType: chunk.mimeType! } as any];
    case 'file':
      return [{ 
        type: 'file', 
        name: chunk.name || 'file', 
        mimeType: chunk.mimeType || 'application/octet-stream',
        data: chunk.data,
        path: chunk.path
      } as any];
    case 'tool_call': {
      const entry = buildToolCallEntry(chunk);
      const json = safeParseJson(chunk.toolRawJson);
      const diffs = extractToolCallDiffEntries(json);
      if (diffs.length > 0) {
        entry.content = diffs;
      }
      if (!isExploringChunk(chunk)) {
        return createToolCallBlocks(entry, chunk.isReplay);
      }
      return [{ type: 'exploring', isStreaming: !chunk.isReplay, isReplay: chunk.isReplay, entries: [entry] } as ExploringBlock];
    }
    case 'plan':
      return [{ type: 'plan', entries: chunk.planEntries || [], isReplay: chunk.isReplay }];
    case 'text':
    default:
      return [{ type: 'text', text: chunk.text || '' }];
  }
}

function closeStreamingExploring(blocks: RichContentBlock[]) {
  if (blocks.length > 0) {
    const last = blocks[blocks.length - 1];
    if (last.type === 'exploring' && (last as ExploringBlock).isStreaming) {
      blocks[blocks.length - 1] = { ...last, isStreaming: false };
    }
  }
}

function handleToolCall(blocks: RichContentBlock[], lastBlock: RichContentBlock | null, chunk: ContentChunk) {
  const entry = buildToolCallEntry(chunk);
  const json = safeParseJson(chunk.toolRawJson);
  const diffs = extractToolCallDiffEntries(json);
  if (diffs.length > 0) {
    entry.content = diffs;
  }

  if (!isExploringChunk(chunk)) {
    closeStreamingExploring(blocks);
    const replacements = createToolCallBlocks(entry, chunk.isReplay);
    const matchingIndexes = blocks
      .map((block, index) => block.type === 'tool_call' && matchesToolCallId((block as ToolCallBlock).entry.toolCallId, entry.toolCallId) ? index : -1)
      .filter(index => index >= 0);
    if (matchingIndexes.length > 0) {
      const existingBlocks = matchingIndexes.map(index => blocks[index] as ToolCallBlock);
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
            result: replacement.entry.result || existing.result
          }
        } as ToolCallBlock;
      });
      blocks.splice(matchingIndexes[0], matchingIndexes.length, ...mergedBlocks);
    } else {
      blocks.push(...replacements);
    }
  } else {
    // Minor tool - group into exploring block
    if (lastBlock && lastBlock.type === 'exploring' && ((lastBlock as ExploringBlock).isStreaming || chunk.isReplay)) {
      const prevEntries = [...(lastBlock as ExploringBlock).entries];
      const eIdx = prevEntries.findIndex(e => e.toolCallId === entry.toolCallId);
      if (eIdx >= 0) {
        prevEntries[eIdx] = entry;
      } else {
        prevEntries.push(entry);
      }
      blocks[blocks.length - 1] = { ...lastBlock, entries: prevEntries } as ExploringBlock;
    } else {
      closeStreamingExploring(blocks);
      blocks.push({ type: 'exploring', isStreaming: !chunk.isReplay, isReplay: chunk.isReplay, entries: [entry] } as ExploringBlock);
    }
  }
}

function handleToolCallUpdate(blocks: RichContentBlock[], chunk: ContentChunk) {
  const tid = chunk.toolCallId;
  if (!tid) return;

  const json = safeParseJson(chunk.toolRawJson);
  const nextTitle = chunk.toolTitle || json.title;
  const nextKind = chunk.toolKind || json.kind;
  const nextStatus = chunk.toolStatus || json.status;
  let nextContent = json.content || json.diff;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];

    if (b.type === 'tool_call' && matchesToolCallId(b.entry.toolCallId, tid)) {
      const matchingIndexes = blocks
        .map((block, index) => block.type === 'tool_call' && matchesToolCallId((block as ToolCallBlock).entry.toolCallId, tid) ? index : -1)
        .filter(index => index >= 0);

      const initialJson = safeParseJson(b.entry.rawJson);
      const diffEntries = extractToolCallDiffEntries(json, initialJson.rawInput);
      const incomingKind = String(nextKind || b.entry.kind || initialJson.kind || json.kind || '').toLowerCase();
      if (diffEntries.length > 0) {
        nextContent = diffEntries;
      } else if (incomingKind === 'edit') {
        const hasIncomingDiffContent = Array.isArray(nextContent)
          && nextContent.some((item: any) => item?.type === 'diff' || (item?.path !== undefined && item?.newText !== undefined));
        if (!hasIncomingDiffContent) {
          nextContent = b.entry.content;
        }
      }

      // Merge rawInput from initial tool_call into update json so command extraction still works
      let mergedRawJson = chunk.toolRawJson || b.entry.rawJson;
      if (chunk.toolRawJson && initialJson.rawInput && !json.rawInput) {
        try {
          const updateObj = JSON.parse(chunk.toolRawJson);
          updateObj.rawInput = initialJson.rawInput;
          mergedRawJson = JSON.stringify(updateObj);
        } catch {
          // keep as-is
        }
      }

      const updatedBaseEntry: ToolCallEntry = {
        ...buildToolCallEntry(chunk),
        status: nextStatus || b.entry.status,
        title: nextTitle || b.entry.title,
        kind: nextKind || b.entry.kind,
        rawJson: mergedRawJson,
        locations: json.locations || b.entry.locations,
        content: nextContent || b.entry.content,
        result: b.entry.result
      };
      const currentKind = updatedBaseEntry.kind || b.entry.kind || json.kind;
      const resultText = extractResultTexts(json);
      if (resultText) {
        const merged = isExecuteToolKind(currentKind)
          ? replaceToolOutput(resultText, undefined, currentKind)
          : appendToolOutput(updatedBaseEntry.result, resultText, undefined, currentKind);
        updatedBaseEntry.result = merged.text;
      }
      const replacements = createToolCallBlocks(updatedBaseEntry, chunk.isReplay);
      const existingBlocks = matchingIndexes.map(index => blocks[index] as ToolCallBlock);
      const mergedBlocks = replacements.map((replacement, index) => {
        const existing = existingBlocks[index]?.entry;
        if (!existing) return replacement;
        return {
          ...replacement,
          entry: {
            ...existing,
            ...replacement.entry,
            result: replacement.entry.result || existing.result
          }
        } as ToolCallBlock;
      });
      blocks.splice(matchingIndexes[0], matchingIndexes.length, ...mergedBlocks);
      return;
    }

    if (b.type === 'exploring') {
      const exp = b as ExploringBlock;
      const idx = exp.entries.findIndex(e => e.toolCallId === tid);
      if (idx >= 0) {
        const e = { ...exp.entries[idx] };
        if (nextStatus) e.status = nextStatus;
        if (nextTitle) e.title = nextTitle;
        if (nextKind) e.kind = nextKind;
        if (chunk.toolRawJson) {
          const prevJson = safeParseJson(e.rawJson);
          if (prevJson.rawInput && !json.rawInput) {
            try {
              const updateObj = JSON.parse(chunk.toolRawJson);
              updateObj.rawInput = prevJson.rawInput;
              e.rawJson = JSON.stringify(updateObj);
            } catch {
              e.rawJson = chunk.toolRawJson;
            }
          } else {
            e.rawJson = chunk.toolRawJson;
          }
        }
        if (json.locations) e.locations = json.locations;
        if (nextContent) e.content = nextContent;
        const currentKind = nextKind || e.kind || json.kind;
        const resultText = extractResultTexts(json);
        if (resultText) {
          const merged = isExecuteToolKind(currentKind)
            ? replaceToolOutput(resultText, undefined, currentKind)
            : appendToolOutput(e.result, resultText, undefined, currentKind);
          e.result = merged.text;
        }
        const newEntries = [...exp.entries];
        newEntries[idx] = e;
        blocks[i] = { ...exp, entries: newEntries };
        return;
      }
    }
  }

  // No existing block found - create one from the update data.
  // This handles the case where the initial ToolCall event was not
  // delivered (e.g. it only arrived via requestPermissions, not session/update).
  const entry = buildToolCallEntry(chunk);
  const diffEntries = extractToolCallDiffEntries(json);
  if (diffEntries.length > 0) {
    entry.content = diffEntries;
  }
  const resultText = extractResultTexts(json);
  if (resultText) {
    const merged = replaceToolOutput(resultText, undefined, entry.kind || json.kind);
    entry.result = merged.text;
  }
  if (entry.kind === 'edit'&& (!Array.isArray(entry.content) || entry.content.length === 0) && !entry.result) {
    return;
  }
  if (!isExploringChunk(chunk)) {
    closeStreamingExploring(blocks);
    blocks.push(...createToolCallBlocks(entry, chunk.isReplay));
  } else {
    const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
    if (lastBlock && lastBlock.type === 'exploring' && ((lastBlock as ExploringBlock).isStreaming || chunk.isReplay)) {
      const prevEntries = [...(lastBlock as ExploringBlock).entries];
      prevEntries.push(entry);
      blocks[blocks.length - 1] = { ...lastBlock, entries: prevEntries } as ExploringBlock;
    } else {
      closeStreamingExploring(blocks);
      blocks.push({ type: 'exploring', isStreaming: !chunk.isReplay, isReplay: chunk.isReplay, entries: [entry] } as ExploringBlock);
    }
  }
}

// Apply a batch of chunks atomically - guarantees ordering and no lost updates.
function applyChunks(messages: Message[], chunks: ContentChunk[]): Message[] {
  let result = messages;
  for (const chunk of chunks) {
    result = applyOneChunk(result, chunk);
  }
  return result;
}

function lastAssistantMessageHasMeta(messages: Message[]): boolean {
  if (messages.length === 0) return false;
  const lastMessage = messages[messages.length - 1];
  return lastMessage.role === 'assistant' && !!lastMessage.metaComplete;
}

export function useChatSession(
  conversationId: string,
  availableAgents: AgentOption[],
  initialAgentId?: string,
  historySession?: HistorySessionMeta,
  pendingHandoff?: PendingHandoffContext,
  onHandoffConsumed?: (handoffId: string) => void
) {
  const [historyMessages, setHistoryMessages] = useState<Message[]>([]);
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [status, setStatus] = useState<string>('not started');
  const [isSending, setIsSending] = useState(false);
  const [isHistoryReplaying, setIsHistoryReplaying] = useState(!!historySession);
  const [selectedModelByAgent, setSelectedModelByAgent] = useState<Record<string, string>>({});
  const [selectedModeByAgent, setSelectedModeByAgent] = useState<Record<string, string>>({});
  const [permissionQueue, setPermissionQueue] = useState<PermissionRequest[]>([]);
  const permissionRequest = permissionQueue[0] ?? null;
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [acpSessionId, setAcpSessionId] = useState<string>('');
  const [availableCommandsByAgent, setAvailableCommandsByAgent] = useState<Record<string, AvailableCommand[]>>({});
  const messages = useMemo(() => [...historyMessages, ...liveMessages], [historyMessages, liveMessages]);
  const selectedAgentId = initialAgentId || '';

  const pendingPromptRef = useRef<any[] | null>(null);
  const pendingHandoffRef = useRef<PendingHandoffContext | null>(null);
  const consumedHandoffIdRef = useRef<string | null>(null);
  const resetSessionAfterInitialCancelRef = useRef(false);
  const startedAgentIdRef = useRef<string>('');
  const startedModelIdRef = useRef<string>('');
  const startedModeIdRef = useRef<string>('');
  const historyLoadRequestedRef = useRef<string | null>(null);
  const statusRef = useRef<string>('not started');
  const startTimeRef = useRef<number | null>(null);
  const historyLoadTimerRef = useRef<number | null>(null);
  const lastMetadataFingerprintRef = useRef<string>('');
  const allowMetadataUpdateRef = useRef(!historySession);
  const touchUpdatedAtRef = useRef(!historySession);
  const ignoreReplayChunksRef = useRef(!!historySession);
  const pinnedAgentSnapshotRef = useRef<{
    id: string;
    name?: string;
    iconPath?: string;
    currentModelId?: string;
    availableModels?: AgentOption['availableModels'];
    currentModeId?: string;
    availableModes?: AgentOption['availableModes'];
  } | null>(null);

  // Buffered chunk queue - chunks are collected here and flushed atomically
  const chunkBufferRef = useRef<ContentChunk[]>([]);
  const flushScheduledRef = useRef(false);

  const applyBufferedChunks = useCallback((reason: string) => {
    const chunks = chunkBufferRef.current;
    chunkBufferRef.current = [];
    if (chunks.length === 0 && reason !== 'status-ready') return;
    const replayChunks = chunks.filter((chunk) => chunk.isReplay);
    const liveChunks = chunks.filter((chunk) => !chunk.isReplay);

    setHistoryMessages(prev => {
      const result = replayChunks.length > 0 ? applyChunks(prev, replayChunks) : prev;
      return reason === 'status-ready' ? closeAllStreamingThinking(result) : result;
    });

    setLiveMessages(prev => {
      const result = liveChunks.length > 0 ? applyChunks(prev, liveChunks) : prev;
      return reason === 'status-ready' ? closeAllStreamingThinking(result) : result;
    });
  }, []);

  const flushChunks = useCallback(() => {
    flushScheduledRef.current = false;
    applyBufferedChunks('raf');
  }, [applyBufferedChunks]);

  const enqueueChunk = useCallback((chunk: ContentChunk) => {
    chunkBufferRef.current.push(chunk);
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      requestAnimationFrame(flushChunks);
    }
  }, [flushChunks]);

  const consumeHandoff = useCallback(() => {
    const handoffId = pendingHandoffRef.current?.id;
    if (!handoffId) return;
    consumedHandoffIdRef.current = handoffId;
    pendingHandoffRef.current = null;
    onHandoffConsumed?.(handoffId);
  }, [onHandoffConsumed]);

  const selectedAgent = availableAgents.find((agent) => agent.id === selectedAgentId);
  const pinnedAgentId = selectedAgentId;

  useEffect(() => {
    const snapshotSourceId = pinnedAgentId;
    if (!snapshotSourceId) return;
    const matchingAgent = availableAgents.find((agent) => agent.id === snapshotSourceId);
    if (!matchingAgent) return;
    pinnedAgentSnapshotRef.current = {
      id: matchingAgent.id,
      name: matchingAgent.name,
      iconPath: matchingAgent.iconPath,
      currentModelId: matchingAgent.currentModelId,
      availableModels: matchingAgent.availableModels,
      currentModeId: matchingAgent.currentModeId,
      availableModes: matchingAgent.availableModes,
    };
  }, [availableAgents, pinnedAgentId]);

  const resolvedSelectedAgent = selectedAgent
    ?? (pinnedAgentSnapshotRef.current?.id === pinnedAgentId
      ? ({
          id: pinnedAgentSnapshotRef.current.id,
          name: pinnedAgentSnapshotRef.current.name,
          iconPath: pinnedAgentSnapshotRef.current.iconPath,
          currentModelId: pinnedAgentSnapshotRef.current.currentModelId,
          availableModels: pinnedAgentSnapshotRef.current.availableModels,
          currentModeId: pinnedAgentSnapshotRef.current.currentModeId,
          availableModes: pinnedAgentSnapshotRef.current.availableModes,
        } as AgentOption)
      : undefined);
  const availableCommands = selectedAgentId
    ? (availableCommandsByAgent[selectedAgentId] ?? ACPBridge.getAvailableCommands(selectedAgentId))
    : [];
  const effectiveSelectedAgent = resolvedSelectedAgent;
  const availableModels = effectiveSelectedAgent?.availableModels ?? [];
  const availableModes = effectiveSelectedAgent?.availableModes ?? [];

  const selectedModelId = effectiveSelectedAgent
      ? (selectedModelByAgent[effectiveSelectedAgent.id] || effectiveSelectedAgent.currentModelId || availableModels[0]?.modelId || '')
      : '';

  const selectedModeId = effectiveSelectedAgent
      ? (selectedModeByAgent[effectiveSelectedAgent.id] || effectiveSelectedAgent.currentModeId || availableModes[0]?.id || '')
      : '';

  const adapterDisplayName = resolvedSelectedAgent?.name || '';
  const agentOptions: DropdownOption[] = useMemo(() => {
    const options = availableAgents.map((agent) => ({
      id: agent.id,
      label: agent.name,
      iconPath: agent.iconPath,
      subOptions: agent.availableModels?.map(m => ({
        id: m.modelId,
        label: m.name,
        description: m.description,
      }))
    }));

    const pinnedSnapshot = pinnedAgentSnapshotRef.current;
    const selectedId = pinnedAgentId;
    if (
      pinnedSnapshot &&
      selectedId &&
      pinnedSnapshot.id === selectedId &&
      !options.some((option) => option.id === selectedId)
    ) {
      options.unshift({
        id: pinnedSnapshot.id,
        label: pinnedSnapshot.name || pinnedSnapshot.id,
        iconPath: pinnedSnapshot.iconPath,
        subOptions: pinnedSnapshot.availableModels?.map((model) => ({
          id: model.modelId,
          label: model.name,
          description: model.description,
        })) || (pinnedSnapshot.currentModelId ? [{
          id: pinnedSnapshot.currentModelId,
          label: pinnedSnapshot.currentModelId,
          description: undefined,
        }] : []),
      });
    }

    return options;
  }, [availableAgents, pinnedAgentId]);
  const modeOptions: DropdownOption[] = useMemo(() => {
    const options = availableModes.map((mode) => ({
      id: mode.id,
      label: mode.name,
      description: mode.description,
    }));

    if (options.length > 0) {
      return options;
    }

    if (selectedModeId) {
      return [{
        id: selectedModeId,
        label: selectedModeId,
        description: undefined,
      }];
    }

    return [];
  }, [availableModes, selectedModeId]);

  useEffect(() => {
    if (availableAgents.length === 0) return;
    setSelectedModelByAgent((prev) => {
      const next: Record<string, string> = { ...prev };
      availableAgents.forEach((agent) => {
        if (next[agent.id]) return;
        const currentModel = agent.currentModelId || agent.availableModels?.[0]?.modelId || '';
        if (currentModel) next[agent.id] = currentModel;
      });
      return next;
    });

    setSelectedModeByAgent((prev) => {
      const next: Record<string, string> = { ...prev };
      availableAgents.forEach((agent) => {
        if (next[agent.id]) return;
        const currentMode = agent.currentModeId || agent.availableModes?.[0]?.id || '';
        if (currentMode) next[agent.id] = currentMode;
      });
      return next;
    });
  }, [availableAgents]);

  useEffect(() => {
    allowMetadataUpdateRef.current = false;
    lastMetadataFingerprintRef.current = '';
    statusRef.current = 'not started';
    setStatus('not started');
    setAcpSessionId('');
    startedAgentIdRef.current = '';
    startedModelIdRef.current = '';
    startedModeIdRef.current = '';
  }, [selectedAgentId]);

  useEffect(() => {
    const nextByAgent: Record<string, AvailableCommand[]> = {};
    availableAgents.forEach((agent) => {
      const commands = ACPBridge.getAvailableCommands(agent.id);
      if (commands.length > 0) {
        nextByAgent[agent.id] = commands;
      }
    });
    setAvailableCommandsByAgent(nextByAgent);
  }, [availableAgents]);

  useEffect(() => {
    if (!historySession) return;
    if (historySession.modelId) {
      setSelectedModelByAgent((prev) => ({
        ...prev,
        [historySession.adapterName]: historySession.modelId as string
      }));
    }
    if (historySession.modeId) {
      setSelectedModeByAgent((prev) => ({
        ...prev,
        [historySession.adapterName]: historySession.modeId as string
      }));
    }
    if (historySession.sessionId) {
      setAcpSessionId(historySession.sessionId);
    }
    allowMetadataUpdateRef.current = false;
    touchUpdatedAtRef.current = false;
    lastMetadataFingerprintRef.current = '';
  }, [historySession]);

  const startSelectedAgent = useCallback(() => {
    if (!selectedAgentId || typeof window.__startAgent !== 'function') return false;
    if (historySession) return false;
    if (!selectedAgent?.downloaded) {
      return false;
    }

    const modelId = selectedModelByAgent[selectedAgentId] || selectedAgent?.currentModelId;

    try {
      startedAgentIdRef.current = selectedAgentId;
      startedModelIdRef.current = modelId || '';
      // startAgent() already applies the adapter's current startup mode on the backend.
      // Keep that as the baseline so we only call __setMode() when the user
      // selected a different mode than the startup-selected mode.
      startedModeIdRef.current = selectedAgent?.currentModeId || '';

      chunkBufferRef.current = [];
      window.__startAgent(conversationId, selectedAgentId, modelId || undefined);
      return true;
    } catch (e) {
      console.warn('[useChatSession] Failed to auto-start agent:', e);
      return false;
    }
  }, [conversationId, historySession, selectedAgent, selectedAgentId, selectedModelByAgent]);

  useEffect(() => {
    if (!pendingHandoff) return;
    if (consumedHandoffIdRef.current === pendingHandoff.id) return;
    pendingHandoffRef.current = pendingHandoff;
  }, [pendingHandoff]);

  // =========================================================================
  // Chat Event Listeners (filtered by conversationId)
  // =========================================================================
  useEffect(() => {
    const unsubAvailableCommands = ACPBridge.onAvailableCommands((e) => {
      const { adapterId, commands } = e.detail;
      setAvailableCommandsByAgent((prev) => ({
        ...prev,
        [adapterId]: commands,
      }));
    });

    // --- UNIFIED content handler: one handler for both streaming and replay ---
    const unsubContent = ACPBridge.onContentChunk((e) => {
      const chunk = e.detail.chunk;
      if (chunk.chatId !== conversationId) return;
      if (chunk.isReplay && ignoreReplayChunksRef.current) {
        return;
      }
      enqueueChunk(chunk);
      if (!chunk.isReplay && chunk.type === 'prompt_done') {
        flushScheduledRef.current = false;
        applyBufferedChunks('prompt-done');
      }
    });

    const unsubConversationReplayLoaded = ACPBridge.onConversationReplayLoaded((e) => {
      const payload = e.detail.payload;
      if (payload.chatId !== conversationId) return;
      ignoreReplayChunksRef.current = true;
      chunkBufferRef.current = [];
      flushScheduledRef.current = false;
      setHistoryMessages(buildReplayMessages(payload.data));
      setIsHistoryReplaying(false);
    });

    const unsubStatus = ACPBridge.onStatus((e) => {
      if (e.detail.chatId !== conversationId) return;
      const s = e.detail.status;
      statusRef.current = s;
      if (s === 'ready' && resetSessionAfterInitialCancelRef.current) {
        resetSessionAfterInitialCancelRef.current = false;
        statusRef.current = 'not started';
        setStatus('not started');
        setAcpSessionId('');
        startedAgentIdRef.current = '';
        startedModelIdRef.current = '';
        startedModeIdRef.current = '';
        setIsSending(false);
      } else {
        setStatus(s);
      }

      if (s === 'initializing') {
        // We don't set isSending(true) here anymore to avoid blocking the user
      }

      if (s === 'ready' || s === 'error') {
        startTimeRef.current = null;

        // Flush any remaining buffered chunks through the same path as RAF flush.
        flushScheduledRef.current = false;
        applyBufferedChunks('status-ready');

        if (!pendingPromptRef.current && !historySession) {
          setIsHistoryReplaying(false);
        }
      }

      // Error is merged into ready block

      if (s === 'ready' && pendingPromptRef.current && typeof window.__sendPrompt === 'function') {
        const blocksToSend = pendingPromptRef.current;
        pendingPromptRef.current = null;

        setIsSending(true);
        
        // Assistant message is already added in handleSend, we just need to trigger the actual send
        try {
          window.__sendPrompt(conversationId, JSON.stringify(blocksToSend));
          consumeHandoff();
        } catch (err) {
          pendingPromptRef.current = blocksToSend;
          console.warn('[useChatSession] Failed to send pending blocks:', err);
          setIsSending(false);
        }
      }
    });

    const unsubSessionId = ACPBridge.onSessionId((e) => {
      if (e.detail.chatId !== conversationId) return;
      setAcpSessionId(e.detail.sessionId);
      allowMetadataUpdateRef.current = true;
      lastMetadataFingerprintRef.current = '';
    });

    const unsubMode = ACPBridge.onMode((e) => {
      if (e.detail.chatId !== conversationId) return;
      startedModeIdRef.current = e.detail.modeId;
    });

    // Permission request - filter by chatId when available
    const unsubPermission = ACPBridge.onPermissionRequest((e) => {
      const req = e.detail.request as PermissionRequest;
      if (req.chatId && req.chatId !== conversationId) return;
      setPermissionQueue((prev) => [...prev, req]);
    });

    return () => {
      unsubAvailableCommands();
      unsubContent();
      unsubConversationReplayLoaded();
      unsubStatus();
      unsubSessionId();
      unsubMode();
      unsubPermission();
    };
  }, [conversationId, enqueueChunk, applyBufferedChunks, consumeHandoff]);

  useEffect(() => {
    if (!isSending || isHistoryReplaying) return;
    if (!lastAssistantMessageHasMeta(messages)) return;
    setIsSending(false);
  }, [messages, isSending, isHistoryReplaying]);

  // Handle native attachments from backend
  useEffect(() => {
    const unsub = ACPBridge.onAttachmentsAdded((e) => {
      const { chatId: cid, files } = e.detail;
      if (cid !== conversationId) return;
      setAttachments((prev) => [...prev, ...files]);
    });
    return unsub;
  }, [conversationId]);

  useEffect(() => {
    if (!historySession) return;
    const loadRequestKey = historySession.conversationId;
    if (historyLoadRequestedRef.current === loadRequestKey) return;

    chunkBufferRef.current = [];
    pendingPromptRef.current = null;
    setHistoryMessages([]);
    setLiveMessages([]);
    setStatus('initializing');
    setIsHistoryReplaying(true);
    ignoreReplayChunksRef.current = true;

    startedAgentIdRef.current = historySession.adapterName;
    startedModelIdRef.current = historySession.modelId || '';
    startedModeIdRef.current = historySession.modeId || '';

    if (historyLoadTimerRef.current !== null) {
      window.clearTimeout(historyLoadTimerRef.current);
      historyLoadTimerRef.current = null;
    }

    historyLoadTimerRef.current = window.setTimeout(() => {
      if (historyLoadRequestedRef.current === loadRequestKey) {
        return;
      }
      historyLoadRequestedRef.current = loadRequestKey;
      ACPBridge.loadHistoryConversation(
        conversationId,
        historySession.projectPath,
        historySession.conversationId
      );
      historyLoadTimerRef.current = null;
    }, 0);

    return () => {
      if (historyLoadTimerRef.current !== null) {
        window.clearTimeout(historyLoadTimerRef.current);
        historyLoadTimerRef.current = null;
      }
    };
  }, [conversationId, historySession]);

  useEffect(() => {
    if (status !== 'ready') return;
    if (!acpSessionId || !selectedAgentId) return;
    if (!allowMetadataUpdateRef.current) return;

    const promptCount = messages.filter((message) => message.role === 'user').length;
    if (promptCount <= 0) return;

    const title = titleFromFirstPrompt(messages);
    const fingerprint = `${acpSessionId}|${selectedAgentId}|${promptCount}|${title || ''}`;
    if (lastMetadataFingerprintRef.current === fingerprint) return;

    ACPBridge.updateSessionMetadata({
      conversationId,
      sessionId: acpSessionId,
      adapterName: selectedAgentId,
      promptCount,
      title,
      touchUpdatedAt: touchUpdatedAtRef.current
    });
    window.setTimeout(() => {
      ACPBridge.requestHistoryList();
    }, 100);
    lastMetadataFingerprintRef.current = fingerprint;
  }, [conversationId, status, acpSessionId, selectedAgentId, messages]);


  // Track model changes
  useEffect(() => {
    if (!selectedAgentId || !selectedModelId) return;
    if (status !== 'ready') return;
    if (startedAgentIdRef.current !== selectedAgentId) return;

    if (startedModelIdRef.current === selectedModelId) {
      return;
    }

    if (typeof window.__setModel !== 'function') return;
    try {
      window.__setModel(conversationId, selectedAgentId, selectedModelId);
      startedModelIdRef.current = selectedModelId;
    } catch (e) {
      console.warn('[useChatSession] Failed to set model:', e);
    }
  }, [conversationId, selectedAgentId, selectedModelId, status]);

  // Track mode changes
  useEffect(() => {
    if (!selectedAgentId || !selectedModeId) return;
    if (status !== 'ready') return;
    if (startedAgentIdRef.current !== selectedAgentId) return;

    if (startedModeIdRef.current === selectedModeId) {
      return;
    }

    if (typeof window.__setMode !== 'function') return;
    try {
      window.__setMode(conversationId, selectedAgentId, selectedModeId);
      startedModeIdRef.current = selectedModeId;
    } catch (e) {
      console.warn('[useChatSession] Failed to set mode:', e);
    }
  }, [conversationId, selectedAgentId, selectedModeId, status]);

  const handleSend = () => {
    const text = inputValue.trim();
    if ((!text && attachments.length === 0) || isSending || status === 'prompting') return;

    if (typeof window.__sendPrompt !== 'function') return;

    // Construct blocks by interleaving text and images
    const blocks: any[] = [];
    let currentText = inputValue;

    const usedAttachmentIds = new Set<string>();
    const placeholderRegex = /\[(image|code-ref)-([a-z0-9-]+)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = placeholderRegex.exec(currentText)) !== null) {
      const beforeText = currentText.substring(lastIndex, match.index);
      if (beforeText) blocks.push({ type: 'text', text: beforeText });

      const attType = match[1];
      const attId = match[2];
      const att = attachments.find(a => a.id === attId);
      if (att) {
        if (attType === 'image') {
          blocks.push({ type: 'image', data: att.data, mimeType: att.mimeType, isInline: true });
        } else if (att.attachmentType === 'code_ref' && att.path) {
          blocks.push({
            type: 'code_ref',
            id: att.id,
            name: att.name,
            path: att.path,
            startLine: att.startLine,
            endLine: att.endLine,
            isInline: true,
          });
        } else {
          blocks.push({ type: 'text', text: match[0] });
        }
        usedAttachmentIds.add(attId);
      } else {
        blocks.push({ type: 'text', text: match[0] }); // Keep as text if not found
      }
      lastIndex = placeholderRegex.lastIndex;
    }

    const remainingText = currentText.substring(lastIndex);
    if (remainingText) blocks.push({ type: 'text', text: remainingText });

    // Append any attachments that weren't explicitly placed
    attachments.forEach(att => {
      if (!usedAttachmentIds.has(att.id) && att.attachmentType !== 'code_ref') {
        if (att.mimeType.startsWith('image/') && att.data) {
          blocks.push({ type: 'image', data: att.data, mimeType: att.mimeType, isInline: false });
        } else if (att.mimeType.startsWith('audio/') && att.data) {
          blocks.push({ type: 'audio', data: att.data, mimeType: att.mimeType, isInline: false });
        } else {
          blocks.push({ 
            type: 'file', 
            name: att.name, 
            mimeType: att.mimeType, 
            data: att.data, 
            path: att.path,
            isInline: false
          });
        }
      }
    });

    const normalizedBlocks = normalizeOutgoingBlocks(blocks);
    if (normalizedBlocks.length === 0) return;
    const outgoingBlocks = pendingHandoffRef.current
      ? prependHandoffContext(normalizedBlocks, pendingHandoffRef.current.text)
      : normalizedBlocks;

    allowMetadataUpdateRef.current = true;
    touchUpdatedAtRef.current = true;
    setIsSending(true);
    const userMessage: Message = {
      id: nextMessageId('user'),
      role: 'user',
      content: plainTextFromBlocks(normalizedBlocks),
      blocks: normalizedBlocks,
      timestamp: Date.now(),
    };
    setLiveMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setAttachments([]);
    const promptStartedAt = Date.now();
    startTimeRef.current = promptStartedAt;
    const assistantMessage: Message = {
      id: nextMessageId('assistant'),
      role: 'assistant',
      content: '',
      contentBlocks: [],
      timestamp: Date.now(),
      agentId: selectedAgentId,
      agentName: adapterDisplayName,
      modelName: selectedModelId,
      modeName: selectedModeId,
      promptStartedAtMillis: promptStartedAt,
      metaComplete: false,
    };
    setLiveMessages((prev) => [...prev, assistantMessage]);

    if (status !== 'ready' && status !== 'error') {
      // Queue it up
      pendingPromptRef.current = outgoingBlocks;
      if (status === 'not started' || status === 'error') {
        startSelectedAgent();
      }
      return;
    }

    try {
      window.__sendPrompt(conversationId, JSON.stringify(outgoingBlocks));
      consumeHandoff();
      setPermissionQueue([]);
    } catch (e) {
      console.warn('[useChatSession] Failed to send prompt:', e);
      setIsSending(false);
    }
  };

  const handleStop = () => {
    if (typeof window.__cancelPrompt === 'function') {
      const liveUserMessageCount = liveMessages.filter((message) => message.role === 'user').length;
      resetSessionAfterInitialCancelRef.current = !historySession && liveUserMessageCount === 1;
      pendingPromptRef.current = null;
      window.__cancelPrompt(conversationId);
      setPermissionQueue([]);
    }
  };

  const handlePermissionDecision = (decision: string) => {
    if (!permissionRequest) return;
    try {
      if (window.__respondPermission) {
        window.__respondPermission(permissionRequest.requestId, decision);
      }
      // Dequeue the answered request; if more are pending the next one becomes visible automatically.
      setPermissionQueue((prev) => prev.slice(1));
    } catch (e) {
      console.warn('[useChatSession] Failed to respond to permission:', e);
    }
  };

  const handleModelChange = (modelId: string, targetAgentId?: string) => {
    const agentId = targetAgentId || selectedAgentId;
    setSelectedModelByAgent((prev) => (
        agentId ? { ...prev, [agentId]: modelId } : prev
    ));
  };

  const handleModeChange = (modeId: string) => {
    setSelectedModeByAgent((prev) => (
        selectedAgentId ? { ...prev, [selectedAgentId]: modeId } : prev
    ));
  };

  return {
    messages,
    inputValue,
    setInputValue,
    status,
    isSending,
    isHistoryReplaying,
    selectedAgentId,
    agentOptions,
    selectedModelId,
    handleModelChange,
    selectedModeId,
    modeOptions,
    handleModeChange,
    permissionRequest,
    handleSend,
    handleStop,
    handlePermissionDecision,
    hasSelectedAgent: !!resolvedSelectedAgent,
    attachments,
    setAttachments,
    availableCommands,
    acpSessionId,
    adapterName: selectedAgentId,
    adapterDisplayName,
    adapterIconPath: resolvedSelectedAgent?.iconPath || ''
  };
}

// Helper: close all streaming exploring blocks in the last assistant message
function closeAllStreamingThinking(messages: Message[]): Message[] {
  if (messages.length === 0) return messages;
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== 'assistant' || !lastMsg.contentBlocks) return messages;

  let changed = false;
  const blocks = lastMsg.contentBlocks.map(block => {
    if (block.type === 'exploring' && (block as ExploringBlock).isStreaming) {
      changed = true;
      return { ...block, isStreaming: false };
    }
    return block;
  });

  if (!changed) return messages;
  return [
    ...messages.slice(0, -1),
    { ...lastMsg, contentBlocks: blocks }
  ];
}










