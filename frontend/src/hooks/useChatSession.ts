import { useState, useEffect, useRef } from 'react';
import {
  Message,
  AgentOption,
  PermissionRequest,
  DropdownOption,
  HistorySessionMeta,
  RichContentBlock,
  TextBlock,
  ThinkingBlock
} from '../types/chat';
import { ACPBridge } from '../utils/bridge';

let messageCounter = 0;
function nextMessageId(suffix: string): string {
  return `msg-${++messageCounter}-${Date.now()}-${suffix}`;
}

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

  const currentBlocksRef = useRef<RichContentBlock[]>([]);
  const currentTextAccumRef = useRef<string>('');
  const currentThinkingAccumRef = useRef<string>('');
  const pendingMessageRef = useRef<string | null>(null);
  const pendingModeIdRef = useRef<string | null>(null);
  const startedAgentIdRef = useRef<string>('');
  const startedModelIdRef = useRef<string>('');
  const startedModeIdRef = useRef<string>('');
  const historyLoadRequestedRef = useRef<string | null>(null);
  const statusRef = useRef<string>('not started');

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

  // Chat Event Listeners (Filtered by chatId)
  useEffect(() => {
    const updateAssistantMessage = (blocks: RichContentBlock[]) => {
      // Use JSON deep clone to ensure React state detects all nested object mutations
      const blocksClone: RichContentBlock[] = JSON.parse(JSON.stringify(blocks));

      const textContent = blocksClone
          .filter((b): b is TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('');

      setMessages((prev) => {
        const newMessages = [...prev];
        // Searching backwards to find the last assistant message
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (newMessages[i].role === 'assistant') {
            newMessages[i] = {
              ...newMessages[i],
              content: textContent,
              contentBlocks: blocksClone,
            };
            return newMessages;
          }
        }
        return prev;
      });
    };

    const closeStreamingThinking = () => {
      if (currentBlocksRef.current.length > 0) {
        const lastBlock = currentBlocksRef.current[currentBlocksRef.current.length - 1];
        if (lastBlock.type === 'thinking' && (lastBlock as ThinkingBlock).isStreaming) {
          (lastBlock as ThinkingBlock).isStreaming = false;
          (lastBlock as ThinkingBlock).endTime = Date.now();
        }
      }
    };



    const unsubText = ACPBridge.onAgentText((e) => {
      if (e.detail.chatId !== chatId) return;

      closeStreamingThinking();

      const newText = e.detail.text;
      currentTextAccumRef.current += newText;

      const blocks = currentBlocksRef.current;
      if (blocks.length > 0 && blocks[blocks.length - 1].type === 'text') {
        (blocks[blocks.length - 1] as TextBlock).text += newText;
      } else {
        blocks.push({ type: 'text', text: newText });
      }

      updateAssistantMessage(blocks);
    });

    const unsubThought = ACPBridge.onAgentThought((e) => {
      if (e.detail.chatId !== chatId) return;

      const newThought = e.detail.text;
      currentThinkingAccumRef.current += newThought;

      const blocks = currentBlocksRef.current;
      const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
      const isReplay = statusRef.current !== 'prompting';

      if (lastBlock && lastBlock.type === 'thinking' && ((lastBlock as ThinkingBlock).isStreaming || isReplay)) {
        (lastBlock as ThinkingBlock).text += newThought;
      } else {
        closeStreamingThinking();
        blocks.push({ 
          type: 'thinking', 
          text: newThought, 
          isStreaming: !isReplay, 
          startTime: !isReplay ? Date.now() : undefined 
        });
        currentTextAccumRef.current = '';
      }

      updateAssistantMessage(blocks);
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
        closeStreamingThinking();

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

        currentBlocksRef.current = [];
        currentTextAccumRef.current = '';
        currentThinkingAccumRef.current = '';

        const assistantMessage: Message = {
          id: nextMessageId('assistant'),
          role: 'assistant',
          content: '',
          contentBlocks: [],
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);

        try {
          // Note: In pending state we currently only support text
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

    const unsubReplay = ACPBridge.onHistoryReplay((e) => {
      if (e.detail.chatId !== chatId) return;

      const { role, text, content } = e.detail;
      const block = (content || { type: 'text', text: text || '' }) as RichContentBlock;
      if (block.type === 'text' && !block.text) return;

      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.role !== role) {
          const newMessage: Message = {
            id: nextMessageId(role),
            role,
            content: block.type === 'text' ? block.text || '' : '',
            blocks: [block],
            timestamp: Date.now()
          };
          // Correct mapping from saved block to contentBlock natively.
          if (role === 'assistant') {
            newMessage.contentBlocks = [block as any];
          }
          return [...prev, newMessage];
        }

        // Handle block merging for text
        const newBlocks = [...(lastMsg.blocks || [])];
        const newRichBlocks = [...(lastMsg.contentBlocks || [])];

        if (block.type === 'text') {
          if (newBlocks.length > 0 && newBlocks[newBlocks.length - 1].type === 'text') {
            newBlocks[newBlocks.length - 1] = {
              ...newBlocks[newBlocks.length - 1],
              text: ((newBlocks[newBlocks.length - 1] as TextBlock).text || '') + (block.text || '')
            } as TextBlock;
          } else {
            newBlocks.push(block);
          }

          if (newRichBlocks.length > 0 && newRichBlocks[newRichBlocks.length - 1].type === 'text') {
            newRichBlocks[newRichBlocks.length - 1] = {
              ...newRichBlocks[newRichBlocks.length - 1],
              text: (newRichBlocks[newRichBlocks.length - 1] as TextBlock).text + (block.text || '')
            } as any;
          } else {
            newRichBlocks.push({ type: 'text', text: block.text || '' });
          }
        } else if (block.type === 'thinking') {
          if (newBlocks.length > 0 && newBlocks[newBlocks.length - 1].type === 'thinking') {
            const separator = ((newBlocks[newBlocks.length - 1] as ThinkingBlock).text || '').endsWith('\n') ? '\n' : '\n\n';
            newBlocks[newBlocks.length - 1] = {
              ...newBlocks[newBlocks.length - 1],
              text: ((newBlocks[newBlocks.length - 1] as ThinkingBlock).text || '') + separator + (block.text || '')
            } as ThinkingBlock;
          } else {
            newBlocks.push(block);
          }

          if (newRichBlocks.length > 0 && newRichBlocks[newRichBlocks.length - 1].type === 'thinking') {
            const separator = (newRichBlocks[newRichBlocks.length - 1] as ThinkingBlock).text.endsWith('\n') ? '\n' : '\n\n';
            newRichBlocks[newRichBlocks.length - 1] = {
              ...newRichBlocks[newRichBlocks.length - 1],
              text: (newRichBlocks[newRichBlocks.length - 1] as ThinkingBlock).text + separator + (block.text || '')
            } as any;
          } else {
            newRichBlocks.push({ type: 'thinking', text: block.text || '', isStreaming: false });
          }
        } else {
          newBlocks.push(block as any);
          if (role === 'assistant') {
            newRichBlocks.push(block as any);
          }
        }

        return [
          ...prev.slice(0, -1),
          {
            ...lastMsg,
            content: block.type === 'text' ? `${lastMsg.content}${block.text}` : lastMsg.content,
            blocks: newBlocks,
            contentBlocks: newRichBlocks
          }
        ];
      });
    });

    return () => {
      unsubText();
      unsubThought();
      unsubStatus();
      unsubSessionId();

      unsubMode();
      unsubPermission();
      unsubReplay();
    };
  }, [chatId]);

  useEffect(() => {
    if (!historySession) return;
    if (!historySession.sessionId || !historySession.adapterName) return;
    if (historyLoadRequestedRef.current === historySession.sessionId) return;
    historyLoadRequestedRef.current = historySession.sessionId;

    currentBlocksRef.current = [];
    currentTextAccumRef.current = '';
    currentThinkingAccumRef.current = '';
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

      currentBlocksRef.current = [];
      currentTextAccumRef.current = '';
      currentThinkingAccumRef.current = '';

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

    // Minimal interleaved logic: we find [image-ID] placeholders
    // For now, to keep it clean and minimal as requested: 
    // we'll just append images at the end if no placeholders, 
    // or replace placeholders if they exist.

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
      content: text, // Keep original text for UI history
      blocks: blocks, // Store the structured blocks for rich rendering
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setAttachments([]);
    currentBlocksRef.current = [];
    currentTextAccumRef.current = '';
    currentThinkingAccumRef.current = '';

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
