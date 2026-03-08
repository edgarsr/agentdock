import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Message,
  AgentOption,
  PermissionRequest,
  DropdownOption,
  HistorySessionMeta,
  ChatAttachment,
  RichContentBlock,
  TextBlock,
  ExploringBlock,
  ToolCallBlock,
  ToolCallEntry,
  ContentChunk,
  isAgentRunnable
} from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import { safeParseJson, buildToolCallEntry, extractResultTexts, appendToolOutput, truncateToolOutput } from '../utils/toolCallUtils';

function selectPreferredAgentId(agents: AgentOption[], preferredId?: string): string {
  if (preferredId && agents.some((agent) => agent.id === preferredId && isAgentRunnable(agent))) {
    return preferredId;
  }
  return agents.find(isAgentRunnable)?.id || '';
}

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

// ---------------------------------------------------------------------------
// Unified chunk processing — THE SINGLE code path for both streaming and replay.
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

function applyOneChunk(messages: Message[], chunk: ContentChunk): Message[] {
  // Skip empty text/thinking chunks
  if ((chunk.type === 'text' || chunk.type === 'thinking') && !chunk.text) return messages;

  const newMessages = [...messages];
  let lastMsg = newMessages.length > 0 ? { ...newMessages[newMessages.length - 1] } : null;

  // ------ Create new message if role differs or no messages yet ------
  if (!lastMsg || lastMsg.role !== chunk.role) {
    const block = buildBlock(chunk);
    const newMsg: Message = {
      id: nextMessageId(chunk.role),
      role: chunk.role,
      content: chunk.type === 'text' ? (chunk.text || '') : '',
      timestamp: chunk.isReplay ? undefined : Date.now()
    };
    if (chunk.role === 'assistant') {
      newMsg.contentBlocks = [block];
    } else {
      newMsg.blocks = [block];
    }
    newMessages.push(newMsg);
    return newMessages;
  }

  // ------ Same role — merge into existing message ------
  const blocks = getBlocks(lastMsg);
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;

  if (chunk.type === 'text') {
    closeStreamingExploring(blocks);

    if (lastBlock && lastBlock.type === 'text') {
      blocks[blocks.length - 1] = { ...lastBlock, text: (lastBlock as TextBlock).text + (chunk.text || '') };
    } else {
      blocks.push({ type: 'text', text: chunk.text || '' });
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
        const separator = chunk.isReplay ? (existingText.endsWith('\n') ? '\n' : '\n\n') : '';
        prevEntries[prevEntries.length - 1] = {
          ...lastEntry,
          text: existingText + separator + (chunk.text || '')
        };
      } else {
        // Add new thinking entry
        prevEntries.push({
          toolCallId: `thinking-${++thinkingCounter}`,
          kind: 'thinking',
          text: chunk.text || '',
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
          text: chunk.text || '',
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

function buildBlock(chunk: ContentChunk): RichContentBlock {
  switch (chunk.type) {
    case 'thinking':
      return {
        type: 'exploring',
        isStreaming: !chunk.isReplay,
        isReplay: chunk.isReplay,
        entries: [{
          toolCallId: `thinking-${++thinkingCounter}`,
          kind: 'thinking',
          text: chunk.text || '',
          rawJson: ''
        }]
      };
    case 'image':
      return { type: 'image', data: chunk.data!, mimeType: chunk.mimeType! } as any;
    case 'audio':
      return { type: 'audio', data: chunk.data!, mimeType: chunk.mimeType! } as any;
    case 'video':
      return { type: 'video', data: chunk.data!, mimeType: chunk.mimeType! } as any;
    case 'file':
      return { 
        type: 'file', 
        name: chunk.name || 'file', 
        mimeType: chunk.mimeType || 'application/octet-stream',
        data: chunk.data,
        path: chunk.path
      } as any;
    case 'tool_call': {
      const entry = buildToolCallEntry(chunk);
      if (!isExploringChunk(chunk)) {
        return { type: 'tool_call', entry } as ToolCallBlock;
      }
      return { type: 'exploring', isStreaming: !chunk.isReplay, isReplay: chunk.isReplay, entries: [entry] } as ExploringBlock;
    }
    case 'plan':
      return { type: 'plan', entries: chunk.planEntries || [], isReplay: chunk.isReplay };
    case 'text':
    default:
      return { type: 'text', text: chunk.text || '' };
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

  if (!isExploringChunk(chunk)) {
    closeStreamingExploring(blocks);

    const idx = blocks.findIndex(b => b.type === 'tool_call' && (b as ToolCallBlock).entry.toolCallId === entry.toolCallId);
    if (idx >= 0) {
      const existing = (blocks[idx] as ToolCallBlock).entry;
      const merged: ToolCallEntry = {
        ...existing,
        ...entry,
        title: entry.title || existing.title,
        kind: entry.kind || existing.kind,
        status: entry.status || existing.status,
        rawJson: entry.rawJson || existing.rawJson,
        locations: entry.locations || existing.locations,
        content: entry.content || existing.content,
        result: entry.result || existing.result
      };
      blocks[idx] = { type: 'tool_call', entry: merged, isReplay: chunk.isReplay } as ToolCallBlock;
    } else {
      blocks.push({ type: 'tool_call', entry, isReplay: chunk.isReplay } as ToolCallBlock);
    }
  } else {
    // Minor tool — group into exploring block
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
  const nextContent = json.content || json.diff;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];

    if (b.type === 'tool_call' && b.entry.toolCallId === tid) {
      const tb = b as ToolCallBlock;
      const updatedEntry: ToolCallEntry = {
        ...tb.entry,
        status: nextStatus || tb.entry.status,
        title: nextTitle || tb.entry.title,
        kind: nextKind || tb.entry.kind,
        rawJson: chunk.toolRawJson || tb.entry.rawJson,
        locations: json.locations || tb.entry.locations,
        content: nextContent || tb.entry.content
      };

      const resultText = extractResultTexts(json);
      if (resultText) {
        const merged = appendToolOutput(updatedEntry.result, resultText);
        updatedEntry.result = merged.text;
      }

      blocks[i] = { ...tb, entry: updatedEntry };
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
        if (chunk.toolRawJson) e.rawJson = chunk.toolRawJson;
        if (json.locations) e.locations = json.locations;
        if (nextContent) e.content = nextContent;
        const resultText = extractResultTexts(json);
        if (resultText) {
          const merged = appendToolOutput(e.result, resultText);
          e.result = merged.text;
        }
        const newEntries = [...exp.entries];
        newEntries[idx] = e;
        blocks[i] = { ...exp, entries: newEntries };
        return;
      }
    }
  }

  // No existing block found — create one from the update data.
  // This handles the case where the initial ToolCall event was not
  // delivered (e.g. it only arrived via requestPermissions, not session/update).
  const entry = buildToolCallEntry(chunk);
  const resultText = extractResultTexts(json);
  if (resultText) {
    const merged = truncateToolOutput(resultText);
    entry.result = merged.text;
  }
  if (!isExploringChunk(chunk)) {
    closeStreamingExploring(blocks);
    blocks.push({ type: 'tool_call', entry, isReplay: chunk.isReplay } as ToolCallBlock);
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

// Apply a batch of chunks atomically — guarantees ordering and no lost updates.
function applyChunks(messages: Message[], chunks: ContentChunk[]): Message[] {
  let result = messages;
  for (const chunk of chunks) {
    result = applyOneChunk(result, chunk);
  }
  return result;
}

// ---------------------------------------------------------------------------

export function useChatSession(
    chatId: string,
    availableAgents: AgentOption[],
    initialAgentId?: string,
    historySession?: HistorySessionMeta
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [status, setStatus] = useState<string>('not started');
  const [isSending, setIsSending] = useState(false);
  const [isHistoryReplaying, setIsHistoryReplaying] = useState(!!historySession);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(initialAgentId || '');
  const [selectedModelByAgent, setSelectedModelByAgent] = useState<Record<string, string>>({});
  const [selectedModeByAgent, setSelectedModeByAgent] = useState<Record<string, string>>({});
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [acpSessionId, setAcpSessionId] = useState<string>('');

  const pendingBlocksRef = useRef<any[] | null>(null);
  const startedAgentIdRef = useRef<string>('');
  const startedModelIdRef = useRef<string>('');
  const startedModeIdRef = useRef<string>('');
  const historyLoadRequestedRef = useRef<string | null>(null);
  const statusRef = useRef<string>('not started');
  const startTimeRef = useRef<number | null>(null);

  // Buffered chunk queue — chunks are collected here and flushed atomically
  const chunkBufferRef = useRef<ContentChunk[]>([]);
  const flushScheduledRef = useRef(false);

  const flushChunks = useCallback(() => {
    flushScheduledRef.current = false;
    const chunks = chunkBufferRef.current;
    if (chunks.length === 0) return;
    chunkBufferRef.current = [];
    setMessages(prev => applyChunks(prev, chunks));
  }, []);

  const enqueueChunk = useCallback((chunk: ContentChunk) => {
    chunkBufferRef.current.push(chunk);
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      requestAnimationFrame(flushChunks);
    }
  }, [flushChunks]);

  const selectedAgent = availableAgents.find((agent) => agent.id === selectedAgentId);
  const availableModels = selectedAgent?.models ?? [];
  const availableModes = selectedAgent?.modes ?? [];

  const selectedModelId = selectedAgent
      ? (selectedModelByAgent[selectedAgent.id] || selectedAgent.defaultModelId || availableModels[0]?.modelId || '')
      : '';

  const selectedModeId = selectedAgent
      ? (selectedModeByAgent[selectedAgent.id] || selectedAgent.defaultModeId || availableModes[0]?.id || '')
      : '';

  const adapterDisplayName = selectedAgent?.name || '';

  const agentOptions: DropdownOption[] = availableAgents.map((agent) => ({ 
    id: agent.id, 
    label: agent.name,
    iconPath: agent.iconPath,
    subOptions: agent.models?.map(m => ({ id: m.modelId, label: m.name }))
  }));
  const modeOptions: DropdownOption[] = availableModes.map((mode) => ({ id: mode.id, label: mode.name }));

  // Sync selection when agents list changes (passed from parent)
  useEffect(() => {
    if (availableAgents.length === 0) return;

    setSelectedAgentId((prev) => {
      if (prev && availableAgents.some((a) => a.id === prev && isAgentRunnable(a))) return prev;
      return selectPreferredAgentId(availableAgents, initialAgentId);
    });

    setSelectedModelByAgent((prev) => {
      const next: Record<string, string> = { ...prev };
      availableAgents.forEach((agent) => {
        if (next[agent.id]) return;
        const defaultModel = agent.defaultModelId || agent.models?.[0]?.modelId || '';
        if (defaultModel) next[agent.id] = defaultModel;
      });
      return next;
    });

    setSelectedModeByAgent((prev) => {
      const next: Record<string, string> = { ...prev };
      availableAgents.forEach((agent) => {
        if (next[agent.id]) return;
        const defaultMode = agent.defaultModeId || agent.modes?.[0]?.id || '';
        if (defaultMode) next[agent.id] = defaultMode;
      });
      return next;
    });
  }, [availableAgents, initialAgentId]);

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
  }, [historySession]);

  // =========================================================================
  // Chat Event Listeners (Filtered by chatId)
  // =========================================================================
  useEffect(() => {

    // --- UNIFIED content handler: one handler for both streaming and replay ---
    const unsubContent = ACPBridge.onContentChunk((e) => {
      const chunk = e.detail.chunk;
      if (chunk.chatId !== chatId) return;
      enqueueChunk(chunk);
    });

    const unsubStatus = ACPBridge.onStatus((e) => {
      if (e.detail.chatId !== chatId) return;
      const s = e.detail.status;
      statusRef.current = s;
      setStatus(s);

      if (s === 'initializing') {
        // We don't set isSending(true) here anymore to avoid blocking the user
      }

      if (s === 'ready') {
        const endTime = Date.now();
        const durationSeconds = startTimeRef.current ? (endTime - startTimeRef.current) / 1000 : undefined;
        startTimeRef.current = null;

        // setPermissionRequest(null); - Handled manually or by new requests. Clearing on 'ready' creates race conditions with tool execution pauses.
        // Flush any remaining buffered chunks immediately before processing status
        if (chunkBufferRef.current.length > 0) {
          flushScheduledRef.current = false;
          const chunks = chunkBufferRef.current;
          chunkBufferRef.current = [];
          setMessages(prev => {
            let result = applyChunks(prev, chunks);
            result = closeAllStreamingThinking(result);
            if (result.length > 0) {
              const last = result[result.length - 1];
              if (last.role === 'assistant' && durationSeconds !== undefined) {
                result[result.length - 1] = {
                  ...last,
                  duration: durationSeconds,
                  agentName: adapterDisplayName,
                  modelName: selectedModelId, // Should ideally be display name
                  modeName: selectedModeId
                };
              }
            }
            return result;
          });
        } else {
          setMessages(prev => {
            const result = closeAllStreamingThinking(prev);
            if (result.length > 0) {
              const last = result[result.length - 1];
              if (last.role === 'assistant' && durationSeconds !== undefined) {
                result[result.length - 1] = {
                  ...last,
                  duration: durationSeconds,
                  agentName: adapterDisplayName,
                  modelName: selectedModelId,
                  modeName: selectedModeId
                };
              }
            }
            return result;
          });
        }

        if (!pendingBlocksRef.current) {
          setIsSending(false);
          setIsHistoryReplaying(false);
        }
      }

      if (s === 'ready' && pendingBlocksRef.current && typeof window.__sendPrompt === 'function') {
        const blocksToSend = pendingBlocksRef.current;
        pendingBlocksRef.current = null;

        setIsSending(true);
        
        // Assistant message is already added in handleSend, we just need to trigger the actual send
        try {
          window.__sendPrompt(chatId, JSON.stringify(blocksToSend));
        } catch (err) {
          console.warn('[useChatSession] Failed to send pending blocks:', err);
          setIsSending(false);
        }
      }
    });

    const unsubSessionId = ACPBridge.onSessionId((e) => {
      if (e.detail.chatId !== chatId) return;
      setAcpSessionId(e.detail.sessionId);
    });

    const unsubMode = ACPBridge.onMode((e) => {
      if (e.detail.chatId !== chatId) return;
      startedModeIdRef.current = e.detail.modeId;
    });

    // Permission request — filter by chatId when available
    const unsubPermission = ACPBridge.onPermissionRequest((e) => {
      const req = e.detail.request as PermissionRequest;
      if (req.chatId && req.chatId !== chatId) return;
      setPermissionRequest(req);
    });

    return () => {
      unsubContent();
      unsubStatus();
      unsubSessionId();
      unsubMode();
      unsubPermission();
    };
  }, [chatId, enqueueChunk, flushChunks, adapterDisplayName, selectedModelId, selectedModeId]);

  // Handle native attachments from backend
  useEffect(() => {
    const unsub = ACPBridge.onAttachmentsAdded((e) => {
      const { chatId: cid, files } = e.detail;
      if (cid !== chatId) return;
      setAttachments((prev) => [...prev, ...files]);
    });
    return unsub;
  }, [chatId]);

  useEffect(() => {
    if (!historySession) return;
    if (!historySession.sessionId || !historySession.adapterName) return;
    if (historyLoadRequestedRef.current === historySession.sessionId) return;
    historyLoadRequestedRef.current = historySession.sessionId;

    chunkBufferRef.current = [];
    pendingBlocksRef.current = null;
    setMessages([]);
    setStatus('initializing');
    setIsSending(true);
    setIsHistoryReplaying(true);

    startedAgentIdRef.current = historySession.adapterName;
    startedModelIdRef.current = historySession.modelId || '';
    startedModeIdRef.current = historySession.modeId || '';

    ACPBridge.loadHistorySession(
        chatId,
        historySession.adapterName,
        historySession.sessionId,
        historySession.modelId,
        historySession.modeId
    );
  }, [chatId, historySession]);

  // Auto-start agent once selection is available
  useEffect(() => {
    if (!selectedAgentId || typeof window.__startAgent !== 'function') return;
    if (historySession) return;

    // Only start if downloaded and, when managed by the plugin, authenticated.
    if (!selectedAgent?.downloaded || (selectedAgent.hasAuthentication && !selectedAgent?.authAuthenticated)) {
      if (status !== 'not started' && status !== 'error') {
        setStatus('not started');
      }
      return;
    }

    if (status !== 'not started' && status !== 'error' && startedAgentIdRef.current === selectedAgentId) return;

    const modelId = selectedModelByAgent[selectedAgentId] || selectedAgent?.defaultModelId;

    try {
      startedAgentIdRef.current = selectedAgentId;
      startedModelIdRef.current = modelId || '';
      startedModeIdRef.current = '';

      chunkBufferRef.current = [];

      window.__startAgent(chatId, selectedAgentId, modelId || undefined);
    } catch (e) {
      console.warn('[useChatSession] Failed to auto-start agent:', e);
    }
  }, [chatId, selectedAgentId, status, availableAgents, historySession]); // Re-run if status is reset to 'not started' or 'error'

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
      window.__setModel(chatId, selectedModelId);
      startedModelIdRef.current = selectedModelId;
    } catch (e) {
      console.warn('[useChatSession] Failed to set model:', e);
    }
  }, [chatId, selectedAgentId, selectedModelId, status]);

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
      window.__setMode(chatId, selectedModeId);
      startedModeIdRef.current = selectedModeId;
    } catch (e) {
      console.warn('[useChatSession] Failed to set mode:', e);
    }
  }, [chatId, selectedAgentId, selectedModeId, status]);

  const handleSend = () => {
    const text = inputValue.trim();
    if ((!text && attachments.length === 0) || isSending || (status !== 'ready' && status !== 'initializing')) return;

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

    setIsSending(true);
    const userMessage: Message = {
      id: nextMessageId('user'),
      role: 'user',
      content: plainTextFromBlocks(normalizedBlocks),
      blocks: normalizedBlocks,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setAttachments([]);
    const assistantMessage: Message = {
      id: nextMessageId('assistant'),
      role: 'assistant',
      content: '',
      contentBlocks: [],
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    if (status !== 'ready') {
      // Queue it up
      pendingBlocksRef.current = normalizedBlocks;
      return;
    }

    try {
      startTimeRef.current = Date.now();
      window.__sendPrompt(chatId, JSON.stringify(normalizedBlocks));
      setPermissionRequest(null);
    } catch (e) {
      console.warn('[useChatSession] Failed to send prompt:', e);
      setIsSending(false);
    }
  };

  const handleStop = () => {
    if (typeof window.__cancelPrompt === 'function') {
      window.__cancelPrompt(chatId);
      setIsSending(false);
      setPermissionRequest(null);
    }
  };

  const handlePermissionDecision = (decision: string) => {
    if (!permissionRequest) return;
    try {
      if (window.__respondPermission) {
        window.__respondPermission(permissionRequest.requestId, decision);
      }
      setPermissionRequest(null);
    } catch (e) {
      console.warn('[useChatSession] Failed to respond to permission:', e);
    }
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModelByAgent((prev) => (
        selectedAgentId ? { ...prev, [selectedAgentId]: modelId } : prev
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
    setSelectedAgentId,
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
    hasSelectedAgent: !!selectedAgent,
    attachments,
    setAttachments,
    acpSessionId,
    adapterName: selectedAgentId,
    adapterDisplayName: selectedAgent?.name || '',
    adapterIconPath: selectedAgent?.iconPath || ''
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
