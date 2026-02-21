import { useState, useEffect, useRef } from 'react';
import { 
  Message, 
  AgentOption, 
  PermissionRequest, 
  DropdownOption,
  HistorySessionMeta
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

  const currentAgentMessageRef = useRef<string>('');
  const pendingMessageRef = useRef<string | null>(null);
  const pendingModeIdRef = useRef<string | null>(null);
  const startedAgentIdRef = useRef<string>('');
  const startedModelIdRef = useRef<string>('');
  const startedModeIdRef = useRef<string>('');
  const historyLoadRequestedRef = useRef<string | null>(null);

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
  }, [historySession]);

  // Chat Event Listeners (Filtered by chatId)
  useEffect(() => {
    const unsubText = ACPBridge.onAgentText((e) => {
      if (e.detail.chatId !== chatId) return;
      
      const text = e.detail.text;
      currentAgentMessageRef.current += text;
      if (currentAgentMessageRef.current.trim()) {
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, content: currentAgentMessageRef.current },
            ];
          }
          return prev;
        });
      }
    });

    const unsubStatus = ACPBridge.onStatus((e) => {
      if (e.detail.chatId !== chatId) return;
      const s = e.detail.status;
      setStatus(s);

      if (s === 'initializing') {
        setIsSending(true);
      }

      if (s === 'ready') {
        const accumulatedText = currentAgentMessageRef.current.trim();
        if (accumulatedText) {
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              if (lastMsg.content !== accumulatedText) {
                return [
                  ...prev.slice(0, -1),
                  { ...lastMsg, content: accumulatedText },
                ];
              }
            }
            return prev;
          });
        }
        currentAgentMessageRef.current = '';
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
        
        currentAgentMessageRef.current = '';
        const assistantMessage: Message = {
            id: nextMessageId('assistant'),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        
        try {
          window.__sendPrompt(chatId, messageToSend);
        } catch (err) {
          console.warn('[useChatSession] Failed to send pending prompt:', err);
          setIsSending(false);
        }
      }
    });

    const unsubSessionId = ACPBridge.onSessionId((e) => {
      if (e.detail.chatId !== chatId) return;
      console.debug('[useChatSession] Session ID for', chatId, ':', e.detail.sessionId);
    });

    const unsubMode = ACPBridge.onMode((e) => {
      if (e.detail.chatId !== chatId) return;
      console.debug('[useChatSession] Backend mode for', chatId, ':', e.detail.modeId);
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
      const role = e.detail.role;
      const text = e.detail.text || '';
      if (!text) return;

      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.role !== role) {
          return [
            ...prev,
            {
              id: nextMessageId(role),
              role,
              content: text,
              timestamp: Date.now()
            }
          ];
        }
        return [
          ...prev.slice(0, -1),
          { ...lastMsg, content: `${lastMsg.content}${text}` }
        ];
      });
    });

    return () => {
      unsubText();
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

    currentAgentMessageRef.current = '';
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
    if (status !== 'not started' && status !== 'error' && startedAgentIdRef.current === selectedAgentId) return;

    const modelId = selectedModelByAgent[selectedAgentId] || selectedAgent?.defaultModelId;
    
    try {
      startedAgentIdRef.current = selectedAgentId;
      startedModelIdRef.current = modelId || '';
      startedModeIdRef.current = '';
      
      console.debug('[useChatSession] Auto-starting agent:', selectedAgentId, 'for chat:', chatId);
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
    
    // Crucial: check against backend value before triggering anything
    if (startedModelIdRef.current === selectedModelId) {
      console.debug('[useChatSession] Model already matches backend:', selectedModelId);
      return;
    }
    
    if (typeof window.__setModel !== 'function') return;
    try {
      console.debug('[useChatSession] Changing model:', startedModelIdRef.current, '->', selectedModelId);
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
      console.debug('[useChatSession] Mode already matches backend:', selectedModeId);
      return;
    }
    
    if (typeof window.__setMode !== 'function') return;
    try {
      console.debug('[useChatSession] Changing mode:', startedModeIdRef.current, '->', selectedModeId);
      window.__setMode(chatId, selectedModeId);
      startedModeIdRef.current = selectedModeId;
    } catch (e) {
      console.warn('[useChatSession] Failed to set mode:', e);
    }
  }, [chatId, selectedAgentId, selectedModeId, status]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || isSending || status !== 'ready') return;

    if (typeof window.__sendPrompt !== 'function') return;
    
    setIsSending(true);
    const userMessage: Message = {
      id: nextMessageId('user'),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    currentAgentMessageRef.current = '';
    
    const assistantMessage: Message = {
      id: nextMessageId('assistant'),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      window.__sendPrompt(chatId, text);
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
    hasSelectedAgent: !!selectedAgent
  };
}
