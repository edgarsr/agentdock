import {
  Message,
  RichContentBlock,
  TextBlock,
  ExploringBlock,
  ToolCallBlock,
  ToolCallEntry,
  ContentChunk,
  ToolCallDiffEntry,
} from '../../types/chat';
import {
  safeParseJson,
  buildToolCallEntry,
  extractResultTexts,
  appendToolOutput,
  replaceToolOutput,
  extractToolCallDiffEntries,
  mergeToolCallDiffEntries,
} from '../../utils/toolCallUtils';
import { nextMessageId } from './messageBasics';
import {
  closeStreamingExploring,
  failPendingToolStatuses,
  getBlocks,
  isExploringChunk,
  setBlocks,
  stripTransferredContextForDisplay,
} from './chunkBlockHelpers';
import { createToolCallBlocks, isExecuteToolKind, matchesToolCallId } from './toolCallBlocks';

function nextThinkingId(): string {
  return `thinking-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function collectToolCallDiffEntries(blocks: ToolCallBlock[]): ToolCallDiffEntry[] {
  return blocks.flatMap((block) => {
    const content = block.entry.content;
    if (!Array.isArray(content)) return [];
    return content
      .filter((item: any) => item?.type === 'diff' || (item?.path !== undefined && item?.newText !== undefined))
      .map((item: any) => ({
        type: 'diff' as const,
        path: typeof item.path === 'string' ? item.path : '',
        oldText: item.oldText ?? null,
        newText: item.newText ?? '',
      }));
  });
}

// Unified chunk processing - one path for both streaming and replay chunks.

function applyPromptDone(messages: Message[], chunk: ContentChunk): Message[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;

    const next = [...messages];
    next[i] = {
      ...message,
      agentId: chunk.agentId ?? message.agentId,
      agentName: chunk.agentName ?? message.agentName,
      configOptions: chunk.configOptions ?? message.configOptions,
      promptStartedAtMillis: chunk.promptStartedAtMillis ?? message.promptStartedAtMillis,
      duration: chunk.durationSeconds ?? message.duration,
      contextTokensUsed: chunk.contextTokensUsed ?? message.contextTokensUsed,
      contextWindowSize: chunk.contextWindowSize ?? message.contextWindowSize,
      contentBlocks: failPendingToolStatuses(message.contentBlocks),
      metaComplete: true,
    };
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
          toolCallId: nextThinkingId(),
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
          toolCallId: nextThinkingId(),
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
  newMessages[newMessages.length - 1] = setBlocks({ ...lastMsg, content: txt }, blocks);
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
          toolCallId: nextThinkingId(),
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
      const existingBlocks = matchingIndexes.map(index => blocks[index] as ToolCallBlock);

      const initialJson = safeParseJson(b.entry.rawJson);
      const diffEntries = extractToolCallDiffEntries(json, initialJson.rawInput);
      const incomingKind = String(nextKind || b.entry.kind || initialJson.kind || json.kind || '').toLowerCase();
      if (diffEntries.length > 0) {
        const existingDiffEntries = incomingKind === 'edit' ? collectToolCallDiffEntries(existingBlocks) : [];
        nextContent = existingDiffEntries.length > 0
          ? mergeToolCallDiffEntries(existingDiffEntries, diffEntries)
          : diffEntries;
      } else if (incomingKind === 'edit') {
        const hasIncomingDiffContent = Array.isArray(nextContent)
          && nextContent.some((item: any) => item?.type === 'diff' || (item?.path !== undefined && item?.newText !== undefined));
        if (!hasIncomingDiffContent) {
          const existingDiffEntries = collectToolCallDiffEntries(existingBlocks);
          nextContent = existingDiffEntries.length > 0 ? existingDiffEntries : b.entry.content;
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
export function applyChunks(messages: Message[], chunks: ContentChunk[]): Message[] {
  let result = messages;
  for (const chunk of chunks) {
    result = applyOneChunk(result, chunk);
  }
  return result;
}

export function lastAssistantMessageHasMeta(messages: Message[]): boolean {
  if (messages.length === 0) return false;
  const lastMessage = messages[messages.length - 1];
  return lastMessage.role === 'assistant' && !!lastMessage.metaComplete;
}

export function closeAllStreamingThinking(messages: Message[]): Message[] {
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
