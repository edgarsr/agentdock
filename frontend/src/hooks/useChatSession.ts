import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Message,
  AgentOption,
  PermissionRequest,
  DropdownOption,
  HistorySessionMeta,
  RichContentBlock,
  TextBlock,
  ExploringBlock,
  ToolCallBlock,
  ToolCallEntry,
  ContentChunk
} from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import { safeParseJson, buildToolCallEntry, extractResultTexts } from '../utils/toolCallUtils';

const EXPLORING_KINDS = new Set(['read', 'fetch', 'search']);

let messageCounter = 0;
let thinkingCounter = 0;
function nextMessageId(suffix: string): string {
  return `msg-${++messageCounter}-${Date.now()}-${suffix}`;
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
      timestamp: Date.now()
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
  } else if (chunk.type === 'tool_call') {
    handleToolCall(blocks, lastBlock, chunk);
  } else if (chunk.type === 'tool_call_update') {
    handleToolCallUpdate(blocks, chunk);
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
    case 'tool_call': {
      const entry = buildToolCallEntry(chunk);
      if (!EXPLORING_KINDS.has(chunk.toolKind || '')) {
        return { type: 'tool_call', entry } as ToolCallBlock;
      }
      return { type: 'exploring', isStreaming: !chunk.isReplay, isReplay: chunk.isReplay, entries: [entry] } as ExploringBlock;
    }
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

  if (!EXPLORING_KINDS.has(chunk.toolKind || '')) {
    closeStreamingExploring(blocks);

    const idx = blocks.findIndex(b => b.type === 'tool_call' && (b as ToolCallBlock).entry.toolCallId === entry.toolCallId);
    if (idx >= 0) {
      const existing = (blocks[idx] as ToolCallBlock).entry;
      const merged: ToolCallEntry = {
        ...existing,
        ...entry,
        locations: entry.locations || existing.locations,
        content: entry.content || existing.content
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

  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];

    if (b.type === 'tool_call' && b.entry.toolCallId === tid) {
      const tb = b as ToolCallBlock;
      const updatedEntry: ToolCallEntry = {
        ...tb.entry,
        status: json.status || tb.entry.status,
        title: json.title || tb.entry.title,
        locations: json.locations || tb.entry.locations,
        content: json.content || json.diff || tb.entry.content
      };

      const resultText = extractResultTexts(json);
      if (resultText) {
        updatedEntry.result = updatedEntry.result ? updatedEntry.result + '\n\n' + resultText : resultText;
      }

      blocks[i] = { ...tb, entry: updatedEntry };
      break;
    }

    if (b.type === 'exploring') {
      const exp = b as ExploringBlock;
      const idx = exp.entries.findIndex(e => e.toolCallId === tid);
      if (idx >= 0) {
        const e = { ...exp.entries[idx] };
        if (json.status) e.status = json.status;
        if (json.locations) e.locations = json.locations;
        if (json.content || json.diff) e.content = json.content || json.diff;
        const newEntries = [...exp.entries];
        newEntries[idx] = e;
        blocks[i] = { ...exp, entries: newEntries };
        break;
      }
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
  const [selectedAgentId, setSelectedAgentId] = useState<string>(initialAgentId || '');
  const [selectedModelByAgent, setSelectedModelByAgent] = useState<Record<string, string>>({});
  const [selectedModeByAgent, setSelectedModeByAgent] = useState<Record<string, string>>({});
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [attachments, setAttachments] = useState<{ id: string; data: string; mimeType: string }[]>([]);
  const [acpSessionId, setAcpSessionId] = useState<string>('');

  const pendingMessageRef = useRef<string | null>(null);
  const pendingModeIdRef = useRef<string | null>(null);
  const startedAgentIdRef = useRef<string>('');
  const startedModelIdRef = useRef<string>('');
  const startedModeIdRef = useRef<string>('');
  const historyLoadRequestedRef = useRef<string | null>(null);
  const statusRef = useRef<string>('not started');

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
      ? (selectedModelByAgent[selectedAgent.id] || selectedAgent.defaultModelId || availableModels[0]?.id || '')
      : '';

  const selectedModeId = selectedAgent
      ? (selectedModeByAgent[selectedAgent.id] || selectedAgent.defaultModeId || availableModes[0]?.id || '')
      : '';

  const agentOptions: DropdownOption[] = availableAgents.map((agent) => ({ id: agent.id, label: agent.displayName }));
  const modelOptions: DropdownOption[] = availableModels.map((model) => ({ id: model.id, label: model.displayName }));
  const modeOptions: DropdownOption[] = availableModes.map((mode) => ({ id: mode.id, label: mode.displayName }));

  // Sync selection when agents list changes (passed from parent)
  useEffect(() => {
    if (availableAgents.length === 0) return;

    setSelectedAgentId((prev) => {
      if (prev && availableAgents.some((a) => a.id === prev)) return prev;
      if (initialAgentId && availableAgents.some((a) => a.id === initialAgentId)) return initialAgentId;
      return availableAgents.find((a) => a.isDefault)?.id || availableAgents[0]?.id || '';
    });

    setSelectedModelByAgent((prev) => {
      const next: Record<string, string> = { ...prev };
      availableAgents.forEach((agent) => {
        if (next[agent.id]) return;
        const defaultModel = agent.defaultModelId || agent.models?.[0]?.id || '';
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
        setIsSending(true);
      }

      if (s === 'ready') {
        setPermissionRequest(null);
        // Flush any remaining buffered chunks immediately before processing status
        if (chunkBufferRef.current.length > 0) {
          flushScheduledRef.current = false;
          const chunks = chunkBufferRef.current;
          chunkBufferRef.current = [];
          setMessages(prev => {
            let result = applyChunks(prev, chunks);
            return closeAllStreamingThinking(result);
          });
        } else {
          setMessages(prev => closeAllStreamingThinking(prev));
        }

        if (!pendingMessageRef.current) {
          setIsSending(false);
        }
      }

      if (s === 'ready' && pendingMessageRef.current && typeof window.__sendPrompt === 'function') {
        const messageToSend = pendingMessageRef.current;
        pendingMessageRef.current = null;

        const desiredMode = pendingModeIdRef.current;
        pendingModeIdRef.current = null;
        if (desiredMode && desiredMode !== startedModeIdRef.current && typeof window.__setMode === 'function') {
          window.__setMode(chatId, desiredMode);
          startedModeIdRef.current = desiredMode;
        }

        setIsSending(true);
        const userMessage: Message = {
          id: nextMessageId('user'),
          role: 'user',
          content: messageToSend,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userMessage]);

        chunkBufferRef.current = [];

        const assistantMessage: Message = {
          id: nextMessageId('assistant'),
          role: 'assistant',
          content: '',
          contentBlocks: [],
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);

        try {
          window.__sendPrompt(chatId, JSON.stringify([{ type: 'text', text: messageToSend }]));
        } catch (err) {
          console.warn('[useChatSession] Failed to send pending prompt:', err);
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
  }, [chatId, enqueueChunk, flushChunks]);

  useEffect(() => {
    if (!historySession) return;
    if (!historySession.sessionId || !historySession.adapterName) return;
    if (historyLoadRequestedRef.current === historySession.sessionId) return;
    historyLoadRequestedRef.current = historySession.sessionId;

    chunkBufferRef.current = [];
    pendingMessageRef.current = null;
    setMessages([]);
    setStatus('initializing');

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

    // Only start if downloaded and authenticated
    if (!selectedAgent?.downloaded || !selectedAgent?.authAuthenticated) {
      if (status !== 'not started' && status !== 'error') {
        setStatus('not started');
      }
      return;
    }

    if (status !== 'not started' && status !== 'error' && startedAgentIdRef.current === selectedAgentId) return;

    const modelId = selectedModelByAgent[selectedAgentId] || selectedAgent?.defaultModelId;

    try {
      if (!selectedAgent?.downloaded || !selectedAgent?.authAuthenticated) {
        return;
      }

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
    if ((!text && attachments.length === 0) || isSending || status !== 'ready') return;

    if (typeof window.__sendPrompt !== 'function') return;

    // Construct blocks by interleaving text and images
    const blocks: any[] = [];
    let currentText = inputValue;

    const usedAttachmentIds = new Set<string>();
    const placeholderRegex = /\[image-([a-z0-9-]+)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = placeholderRegex.exec(currentText)) !== null) {
      const beforeText = currentText.substring(lastIndex, match.index);
      if (beforeText) blocks.push({ type: 'text', text: beforeText });

      const attId = match[1];
      const att = attachments.find(a => a.id === attId);
      if (att) {
        blocks.push({ type: 'image', data: att.data, mimeType: att.mimeType });
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
      if (!usedAttachmentIds.has(att.id)) {
        blocks.push({ type: 'image', data: att.data, mimeType: att.mimeType });
      }
    });

    setIsSending(true);
    const userMessage: Message = {
      id: nextMessageId('user'),
      role: 'user',
      content: text,
      blocks: blocks,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setAttachments([]);
    chunkBufferRef.current = [];

    const assistantMessage: Message = {
      id: nextMessageId('assistant'),
      role: 'assistant',
      content: '',
      contentBlocks: [],
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      window.__sendPrompt(chatId, JSON.stringify(blocks));
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
    selectedAgentId,
    setSelectedAgentId,
    agentOptions,
    selectedModelId,
    modelOptions,
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
    adapterName: selectedAgentId
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
