import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AgentOption,
  ApprovalMode,
  ChatAttachment,
  ForkConversationBase,
  HistorySessionMeta,
  Message,
  PendingHandoffContext,
  PermissionRequest,
  RichContentBlock
} from '../types/chat';
import {ACPBridge} from '../utils/bridge';
import {buildLivePromptMessages, buildReplayMessages} from '../utils/replay';
import {ChatWorkspaceState, uiWorkspace} from '../utils/uiWorkspace';
import {lastAssistantMessageHasMeta} from './chatSession/messageProcessing';
import {
  nextMessageId,
  normalizeOutgoingBlocks,
  plainTextFromBlocks,
  prependHandoffContext,
  titleFromFirstPrompt,
} from './chatSession/messageBasics';
import {buildPromptBlocks} from './chatSession/promptBlocks';
import {
  buildAgentOptions,
  buildModeOptions,
  buildReasoningEffortOptions,
  PinnedAgentSnapshot,
  resolveSelectedAgent,
  toPinnedAgentSnapshot,
} from './chatSession/agentSelection';
import {useAgentRuntimeOptions} from './chatSession/useAgentRuntimeOptions';
import {useAvailableCommands} from './chatSession/useAvailableCommands';
import {useBufferedMessageChunks} from './chatSession/useBufferedMessageChunks';
import {asQueuedPrompt, usePromptQueue} from './chatSession/usePromptQueue';
import {QueuePromptDraft} from './chatSession/promptQueueTypes';
import {useElicitationRequests} from './chatSession/useElicitationRequests';

const EMPTY_ADAPTER_NAMES: string[] = [];
// The backend always reports a terminal status for a session start within its own
// start timeout, so a deferred prompt that outlives it will never be sent.
const PENDING_PROMPT_READY_TIMEOUT_MS = 375_000;

function loadApprovalMode(): ApprovalMode {
  return ACPBridge.getGlobalSettingsSnapshot()?.settings?.approvalMode === 'auto' ? 'auto' : 'ask';
}

// The chats already open keep their own mode; the saved one is what new chats start in.
function saveApprovalMode(mode: ApprovalMode) {
  ACPBridge.saveGlobalSettings({ approvalMode: mode });
}

// ACP marks every permission option with a kind. `allow_once` is the only one that grants a
// single operation without persisting the grant, so it is the only one auto mode may pick.
// When an agent offers none, the request falls through to the normal dialog and the user decides.
function findAutoApproveOption(request: PermissionRequest): PermissionRequest['options'][number] | null {
  return request.options.find((option) => option.kind === 'allow_once') ?? null;
}

function respondToPermission(request: PermissionRequest, decision: string): boolean {
  if (!window.__respondPermission) return false;
  window.__respondPermission(request.requestId, decision);
  return true;
}

export interface UseChatSessionOptions {
  conversationId: string;
  availableAgents: AgentOption[];
  initialAgentId?: string;
  historySession?: HistorySessionMeta;
  pendingHandoff?: PendingHandoffContext;
  initialMessages?: Message[];
  metadataTitleOverride?: string;
  inheritedAdapterNames?: string[];
  forkBase?: ForkConversationBase;
  /** Reopened from the saved workspace: the backend sends the conversation instead of it being loaded. */
  restored?: boolean;
  onHandoffConsumed?: (handoffId: string) => void;
  onUserMessageSent?: () => void;
}

export function useChatSession({
  conversationId,
  availableAgents,
  initialAgentId,
  historySession,
  pendingHandoff,
  initialMessages = [],
  metadataTitleOverride,
  inheritedAdapterNames = EMPTY_ADAPTER_NAMES,
  forkBase,
  restored = false,
  onHandoffConsumed,
  onUserMessageSent,
}: UseChatSessionOptions) {
  // What the chat had in the page it was taken from; the conversation itself comes from the backend.
  const [restoredState] = useState(() => (restored ? uiWorkspace.restoredChatState(conversationId) : undefined));
  const [historyMessages, setHistoryMessages] = useState<Message[]>(initialMessages);
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState(restoredState?.inputValue ?? '');
  const [scheduleEnabled, setScheduleEnabled] = useState(restoredState?.scheduleEnabled ?? false);
  const [scheduledAt, setScheduledAt] = useState<number | undefined>(restoredState?.scheduledAt);
  const [scheduleDraftRevision, setScheduleDraftRevision] = useState(0);
  const [queueError, setQueueError] = useState('');
  const [composerLoadRevision, setComposerLoadRevision] = useState(
    restoredState?.inputValue || restoredState?.attachments.length ? 1 : 0
  );
  const [status, setStatus] = useState<string>('not started');
  const [isSending, setIsSending] = useState(false);
  const [isHistoryReplaying, setIsHistoryReplaying] = useState(!!historySession || restored);
  const [permissionQueue, setPermissionQueue] = useState<PermissionRequest[]>([]);
  const [approvalMode, setApprovalModeState] = useState<ApprovalMode>(() => restoredState?.approvalMode ?? loadApprovalMode());
  const permissionRequest = permissionQueue[0] ?? null;
  const elicitationRequest = useElicitationRequests(conversationId);
  const [attachments, setAttachments] = useState<ChatAttachment[]>(restoredState?.attachments ?? []);
  const [acpSessionId, setAcpSessionId] = useState<string>('');
  const messages = useMemo(() => [...historyMessages, ...liveMessages], [historyMessages, liveMessages]);
  const selectedAgentId = initialAgentId || '';

  const pendingPromptWatchdogRef = useRef<number | null>(null);

  useEffect(() => () => {
    ACPBridge.clearConversationToolCache(conversationId);
    if (pendingPromptWatchdogRef.current !== null) {
      window.clearTimeout(pendingPromptWatchdogRef.current);
      pendingPromptWatchdogRef.current = null;
    }
  }, [conversationId]);

  /** The prompt held until the agent starts; [blocks] carry the handoff context the draft does not. */
  const pendingPromptRef = useRef<{ draft: QueuePromptDraft; blocks: RichContentBlock[] } | null>(null);
  const isQueuedPromptRef = useRef(false);
  const pendingHandoffRef = useRef<PendingHandoffContext | null>(null);
  const consumedHandoffIdRef = useRef<string | null>(null);
  const resetSessionAfterInitialCancelRef = useRef(false);
  // A restored chat is attached instead: the backend already runs or has stored its conversation.
  const historyLoadRequestedRef = useRef<string | null>(restored ? historySession?.conversationId ?? null : null);
  const startTimeRef = useRef<number | null>(null);
  const historyLoadTimerRef = useRef<number | null>(null);
  const lastMetadataFingerprintRef = useRef<string>('');
  const allowMetadataUpdateRef = useRef(!historySession);
  const touchUpdatedAtRef = useRef(!historySession);
  const pinnedAgentSnapshotRef = useRef<PinnedAgentSnapshot | null>(null);
  const initialUserMessageCountRef = useRef(initialMessages.filter((message) => message.role === 'user').length);
  const forkBaseRef = useRef<ForkConversationBase | undefined>(forkBase);

  const {
    applyBufferedChunks,
    enqueueChunk,
    clearBufferedChunks,
    markFlushUnscheduled,
  } = useBufferedMessageChunks({ setHistoryMessages, setLiveMessages });

  const setApprovalMode = useCallback((mode: ApprovalMode) => {
    setApprovalModeState(mode);
    saveApprovalMode(mode);
  }, []);

  const finishActivePromptAfterError = useCallback(() => {
    pendingPromptRef.current = null;
    setPermissionQueue([]);
    setIsSending(false);

    setLiveMessages((prev) => {
      if (prev.length === 0) return prev;
      const lastMessage = prev[prev.length - 1];
      if (lastMessage.role !== 'assistant' || lastMessage.metaComplete) return prev;

      const startedAt = startTimeRef.current ?? lastMessage.promptStartedAtMillis;
      const duration = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : lastMessage.duration;
      return [
        ...prev.slice(0, -1),
        {
          ...lastMessage,
          duration,
          metaComplete: true,
        },
      ];
    });
  }, []);

  const consumeHandoff = useCallback(() => {
    const handoffId = pendingHandoffRef.current?.id;
    if (!handoffId) return;
    consumedHandoffIdRef.current = handoffId;
    pendingHandoffRef.current = null;
    onHandoffConsumed?.(handoffId);
  }, [onHandoffConsumed]);

  const selectedAgent = availableAgents.find((agent) => agent.id === selectedAgentId);

  useEffect(() => {
    if (!selectedAgentId) return;
    const matchingAgent = availableAgents.find((agent) => agent.id === selectedAgentId);
    if (!matchingAgent) return;
    pinnedAgentSnapshotRef.current = toPinnedAgentSnapshot(matchingAgent);
  }, [availableAgents, selectedAgentId]);

  const resolvedSelectedAgent = resolveSelectedAgent(selectedAgent, pinnedAgentSnapshotRef.current, selectedAgentId);
  const availableCommands = useAvailableCommands(availableAgents, selectedAgentId);

  const {
    availableModels,
    availableModes,
    availableReasoningEfforts,
    selectedModelId,
    selectedModeId,
    selectedReasoningEffortId,
    additionalConfigOptions,
    configValues,
    selectedConfigOptions,
    restoreConfigValues,
    handleSessionConfigOptions,
    handleModelChange,
    handleReportedModeChange,
    handleModeChange,
    handleReasoningEffortChange,
    handleConfigOptionChange,
  } = useAgentRuntimeOptions({
    availableAgents,
    effectiveSelectedAgent: resolvedSelectedAgent,
    selectedAgentId,
    sessionActive: status === 'ready' || status === 'prompting',
  });

  useEffect(() => ACPBridge.onSessionConfigOptions((event) => {
    if (event.detail.payload.chatId === conversationId) {
      handleSessionConfigOptions(event.detail.payload, isQueuedPromptRef.current);
    }
  }), [conversationId, handleSessionConfigOptions]);

  // Only on mount: afterwards the chat follows the backend's events.
  useEffect(() => {
    if (!restored) return;
    if (restoredState) restoreConfigValues(restoredState.configValues);
    ACPBridge.attachChat(conversationId, historySession?.projectPath);
  }, []);

  const adapterDisplayName = resolvedSelectedAgent?.name || '';
  const agentOptions = useMemo(
    () => buildAgentOptions(availableAgents, pinnedAgentSnapshotRef.current, selectedAgentId).map((option) => (
      option.id === selectedAgentId
        ? {
            ...option,
            subOptions: availableModels.map((model) => ({
              id: model.modelId,
              label: model.name,
              description: model.description,
            })),
          }
        : option
    )),
    [availableAgents, availableModels, selectedAgentId]
  );
  const modeOptions = useMemo(
    () => buildModeOptions(availableModes, selectedModeId),
    [availableModes, selectedModeId]
  );
  const reasoningEffortOptions = useMemo(
    () => buildReasoningEffortOptions(availableReasoningEfforts, selectedReasoningEffortId),
    [availableReasoningEfforts, selectedReasoningEffortId]
  );

  const failActivePromptLocally = useCallback((message: string) => {
    const text = message.startsWith('[Error:') ? message : `[Error: ${message}]`;
    const startedAt = startTimeRef.current ?? Date.now();
    pendingPromptRef.current = null;
    setPermissionQueue([]);
    setStatus('error');
    setIsSending(false);
    markFlushUnscheduled();
    applyBufferedChunks('bridge-error');

    setLiveMessages((prev) => {
      const duration = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      const lastMessage = prev[prev.length - 1];

      if (lastMessage?.role === 'assistant' && !lastMessage.metaComplete) {
        const existingBlocks = [...(lastMessage.contentBlocks || [])];
        const lastBlock = existingBlocks[existingBlocks.length - 1];
        if (lastBlock?.type === 'text') {
          existingBlocks[existingBlocks.length - 1] = {
            ...lastBlock,
            text: `${lastBlock.text}${text}`,
          };
        } else {
          existingBlocks.push({ type: 'text', text });
        }

        return [
          ...prev.slice(0, -1),
          {
            ...lastMessage,
            content: `${lastMessage.content || ''}${text}`,
            contentBlocks: existingBlocks,
            duration,
            metaComplete: true,
          },
        ];
      }

      return [
        ...prev,
        {
          id: nextMessageId('assistant'),
          role: 'assistant',
          content: text,
          contentBlocks: [{ type: 'text', text }],
          timestamp: Date.now(),
          agentId: selectedAgentId,
          agentName: adapterDisplayName,
          configOptions: selectedConfigOptions,
          promptStartedAtMillis: startedAt,
          duration,
          metaComplete: true,
        },
      ];
    });
    startTimeRef.current = null;
  }, [
    adapterDisplayName,
    applyBufferedChunks,
    markFlushUnscheduled,
    selectedAgentId,
    selectedConfigOptions,
  ]);

  const clearPendingPromptWatchdog = useCallback(() => {
    if (pendingPromptWatchdogRef.current === null) return;
    window.clearTimeout(pendingPromptWatchdogRef.current);
    pendingPromptWatchdogRef.current = null;
  }, []);

  // A deferred prompt must never wait forever: if the agent never reports back,
  // fail the prompt locally so the user sees the reason instead of a spinner.
  const armPendingPromptWatchdog = useCallback(() => {
    clearPendingPromptWatchdog();
    pendingPromptWatchdogRef.current = window.setTimeout(() => {
      pendingPromptWatchdogRef.current = null;
      if (!pendingPromptRef.current) return;
      failActivePromptLocally('The agent never became ready, so the message was not sent. Send it again to retry.');
    }, PENDING_PROMPT_READY_TIMEOUT_MS);
  }, [clearPendingPromptWatchdog, failActivePromptLocally]);

  // Drops the session back to its pre-start state. Every value the agent start records has to be
  // cleared together, so both reset paths go through here rather than repeating the list.
  const resetSessionToNotStarted = useCallback(() => {
    setStatus('not started');
    setAcpSessionId('');
  }, []);

  useEffect(() => {
    allowMetadataUpdateRef.current = false;
    lastMetadataFingerprintRef.current = '';
    resetSessionToNotStarted();
  }, [resetSessionToNotStarted, selectedAgentId]);

  useEffect(() => {
    if (!historySession) return;
    if (historySession.sessionId) {
      setAcpSessionId(historySession.sessionId);
    }
    allowMetadataUpdateRef.current = false;
    touchUpdatedAtRef.current = false;
    lastMetadataFingerprintRef.current = '';
  }, [historySession]);

  const startSelectedAgent = useCallback(() => {
    if (!selectedAgentId) return false;
    if (historySession) return false;
    if (!selectedAgent?.downloaded) {
      return false;
    }

    try {
      clearBufferedChunks();
      setStatus('initializing');
      ACPBridge.startAgent(
        conversationId,
        selectedAgentId,
        pendingPromptRef.current?.draft.configValues ?? configValues
      ).catch((error) => {
        console.warn('[useChatSession] Failed to start agent:', error);
        const message = error instanceof Error ? error.message : String(error);
        failActivePromptLocally(`Prompt was not sent because the agent start request failed. ${message}`);
      });
      return true;
    } catch (e) {
      console.warn('[useChatSession] Failed to auto-start agent:', e);
      return false;
    }
  }, [clearBufferedChunks, configValues, conversationId, failActivePromptLocally, historySession, selectedAgent, selectedAgentId]);

  // Restarts whatever backend work can bring the session back to 'ready' after it
  // broke, so a prompt does not have to wait for a session that nobody restarts.
  const restartSessionForPendingPrompt = useCallback((): boolean => {
    if (!historySession) return startSelectedAgent();
    if (!historySession.projectPath || !historySession.conversationId) return false;

    // The stored replay already holds every finished turn, so keep only the prompt
    // being sent; reloading it back into history would otherwise duplicate them.
    setLiveMessages((prev) => prev.slice(-2));
    clearBufferedChunks();
    setStatus('initializing');
    ACPBridge.loadHistoryConversation(
      conversationId,
      historySession.projectPath,
      historySession.conversationId
    );
    return true;
  }, [clearBufferedChunks, conversationId, historySession, startSelectedAgent]);

  useEffect(() => {
    if (!pendingHandoff) return;
    if (consumedHandoffIdRef.current === pendingHandoff.id) return;
    pendingHandoffRef.current = pendingHandoff;
  }, [pendingHandoff]);

  // =========================================================================
  // Chat Event Listeners (filtered by conversationId)
  // =========================================================================
  useEffect(() => {
    const unsubContent = ACPBridge.onContentChunk((e) => {
      const chunk = e.detail.chunk;
      if (chunk.chatId !== conversationId) return;
      enqueueChunk(chunk);
      if (chunk.type === 'prompt_done') {
        markFlushUnscheduled();
        applyBufferedChunks('prompt-done');
      }
    });

    const unsubConversationReplayLoaded = ACPBridge.onConversationReplayLoaded((e) => {
      const payload = e.detail.payload;
      if (payload.chatId !== conversationId) return;
      clearBufferedChunks();
      setHistoryMessages(buildReplayMessages(payload.data));
      setIsHistoryReplaying(false);
    });

    // Replaces what the chat showed: events the backend sent before the snapshot are part of it.
    const unsubChatAttached = ACPBridge.onChatAttached((e) => {
      const payload = e.detail.payload;
      if (payload.chatId !== conversationId) return;
      clearBufferedChunks();
      if (payload.data) setHistoryMessages(buildReplayMessages(payload.data));
      const livePrompt = payload.livePrompt?.prompt;
      setLiveMessages(livePrompt ? buildLivePromptMessages(livePrompt) : []);
      startTimeRef.current = livePrompt?.assistantMeta?.promptStartedAtMillis ?? null;
      setIsSending(!!livePrompt || payload.status === 'prompting');
      if (payload.status) setStatus(payload.status);
      if (payload.sessionId) setAcpSessionId(payload.sessionId);
      setPermissionQueue(payload.permissions);
      setIsHistoryReplaying(false);
    });

    const unsubStatus = ACPBridge.onStatus((e) => {
      if (e.detail.chatId !== conversationId) return;
      const s = e.detail.status;
      if (s === 'ready' && resetSessionAfterInitialCancelRef.current) {
        resetSessionAfterInitialCancelRef.current = false;
        resetSessionToNotStarted();
        setIsSending(false);
      } else {
        setStatus(s);
      }

      if (s === 'ready' || s === 'error') {
        clearPendingPromptWatchdog();
        startTimeRef.current = null;

        // Flush any remaining buffered chunks through the same path as RAF flush.
        markFlushUnscheduled();
        applyBufferedChunks('status-ready');

        if (!pendingPromptRef.current && !historySession) {
          setIsHistoryReplaying(false);
        }
      }

      if (s === 'error') {
        finishActivePromptAfterError();
      }

      if (s === 'ready' && pendingPromptRef.current) {
        const { draft: prompt, blocks } = pendingPromptRef.current;
        pendingPromptRef.current = null;

        setIsSending(true);

        // Assistant message is already added in handleSend, we just need to trigger the actual send
        const forkBaseToPersist = forkBaseRef.current;
        ACPBridge.sendPrompt(
          conversationId,
          JSON.stringify(blocks),
          forkBaseToPersist,
          prompt.agentId,
          prompt.configValues
        ).then(() => {
          forkBaseRef.current = undefined;
          consumeHandoff();
        }).catch((err) => {
          console.warn('[useChatSession] Failed to send pending blocks:', err);
          const message = err instanceof Error ? err.message : String(err);
          failActivePromptLocally(`Prompt was not sent. ${message}`);
        });
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
      if (!isQueuedPromptRef.current) handleReportedModeChange(e.detail.modeId);
    });

    // Permission request - filter by chatId when available
    const unsubPermission = ACPBridge.onPermissionRequest((e) => {
      const req = e.detail.request as PermissionRequest;
      if (req.chatId && req.chatId !== conversationId) return;
      if (approvalMode === 'auto') {
        const approveOption = findAutoApproveOption(req);
        if (approveOption && respondToPermission(req, approveOption.optionId)) {
          return;
        }
      }
      // A request sent just after a chat's snapshot may be in it already.
      setPermissionQueue((prev) => (prev.some((queued) => queued.requestId === req.requestId) ? prev : [...prev, req]));
    });

    return () => {
      unsubContent();
      unsubConversationReplayLoaded();
      unsubChatAttached();
      unsubStatus();
      unsubSessionId();
      unsubMode();
      unsubPermission();
    };
  }, [
    conversationId,
    approvalMode,
    enqueueChunk,
    applyBufferedChunks,
    clearBufferedChunks,
    clearPendingPromptWatchdog,
    markFlushUnscheduled,
    consumeHandoff,
    failActivePromptLocally,
    finishActivePromptAfterError,
    resetSessionToNotStarted,
    handleReportedModeChange,
  ]);

  useEffect(() => {
    if (!isSending || isHistoryReplaying) return;
    if (!lastAssistantMessageHasMeta(messages)) return;
    setIsSending(false);
  }, [messages, isSending, isHistoryReplaying]);

  // Handle native attachments from backend
  useEffect(() => {
    return ACPBridge.onAttachmentsAdded((e) => {
      const { chatId: cid, files } = e.detail;
      if (cid !== conversationId) return;
      setAttachments((prev) => [...prev, ...files]);
    });
  }, [conversationId]);

  useEffect(() => {
    if (!historySession) return;
    const loadRequestKey = historySession.conversationId;
    if (historyLoadRequestedRef.current === loadRequestKey) return;

    clearBufferedChunks();
    pendingPromptRef.current = null;
    setHistoryMessages([]);
    setLiveMessages([]);
    setStatus('initializing');
    setIsHistoryReplaying(true);

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
  }, [clearBufferedChunks, conversationId, historySession]);

  useEffect(() => {
    if (status !== 'ready') return;
    if (!acpSessionId || !selectedAgentId) return;
    if (!allowMetadataUpdateRef.current) return;

    const promptCount = Math.max(
      0,
      messages.filter((message) => message.role === 'user').length - initialUserMessageCountRef.current
    );
    if (promptCount <= 0) return;

    const title = metadataTitleOverride?.trim() || titleFromFirstPrompt(messages);
    const fingerprint = `${acpSessionId}|${selectedAgentId}|${promptCount}|${title || ''}|${inheritedAdapterNames.join(',')}`;
    if (lastMetadataFingerprintRef.current === fingerprint) return;

    ACPBridge.updateSessionMetadata({
      conversationId,
      sessionId: acpSessionId,
      adapterName: selectedAgentId,
      promptCount,
      title,
      inheritedAdapterNames,
      touchUpdatedAt: touchUpdatedAtRef.current,
      forceTitle: Boolean(metadataTitleOverride?.trim()),
    });
    window.setTimeout(() => {
      ACPBridge.requestHistoryList();
    }, 100);
    lastMetadataFingerprintRef.current = fingerprint;
  }, [conversationId, status, acpSessionId, selectedAgentId, messages, metadataTitleOverride, inheritedAdapterNames]);

  const sendPreparedPrompt = useCallback((
    prompt: QueuePromptDraft,
    outgoingBlocks: RichContentBlock[]
  ) => {
    isQueuedPromptRef.current = 'id' in prompt;
    if (isQueuedPromptRef.current) {
      // Pin composer defaults before the queued configuration is reported by the agent.
      restoreConfigValues(configValues);
    }
    allowMetadataUpdateRef.current = true;
    touchUpdatedAtRef.current = true;
    onUserMessageSent?.();
    setIsSending(true);
    const userMessage: Message = {
      id: nextMessageId('user'),
      role: 'user',
      content: prompt.text,
      blocks: prompt.blocks,
      timestamp: Date.now(),
    };
    setLiveMessages((prev) => [...prev, userMessage]);
    const promptStartedAt = Date.now();
    startTimeRef.current = promptStartedAt;
    const assistantMessage: Message = {
      id: nextMessageId('assistant'),
      role: 'assistant',
      content: '',
      contentBlocks: [],
      timestamp: Date.now(),
      agentId: prompt.agentId,
      agentName: prompt.agentName,
      configOptions: prompt.configOptions,
      promptStartedAtMillis: promptStartedAt,
      metaComplete: false,
    };
    setLiveMessages((prev) => [...prev, assistantMessage]);

    if (status !== 'ready') {
      // Defer the active prompt until the agent finishes starting.
      pendingPromptRef.current = { draft: prompt, blocks: outgoingBlocks };
      if (status === 'not started' || status === 'error') {
        if (!restartSessionForPendingPrompt()) {
          failActivePromptLocally('The agent is not available and the session could not be restarted, so the message was not sent.');
          return;
        }
      }
      armPendingPromptWatchdog();
      return;
    }

    const forkBaseToPersist = forkBaseRef.current;
    ACPBridge.sendPrompt(
      conversationId,
      JSON.stringify(outgoingBlocks),
      forkBaseToPersist,
      prompt.agentId,
      prompt.configValues
    ).then(() => {
      forkBaseRef.current = undefined;
      consumeHandoff();
      setPermissionQueue([]);
    }).catch((e) => {
      console.warn('[useChatSession] Failed to send prompt:', e);
      const message = e instanceof Error ? e.message : String(e);
      failActivePromptLocally(`Prompt was not sent. ${message}`);
    });
  // Refs (pendingHandoffRef, allowMetadataUpdateRef, touchUpdatedAtRef, startTimeRef)
  // are intentionally excluded — their identity is stable across renders.
  }, [status, conversationId, configValues, restoreConfigValues, armPendingPromptWatchdog, restartSessionForPendingPrompt, consumeHandoff, failActivePromptLocally, onUserMessageSent]);

  const canDrainQueuedPrompts = (status === 'ready'
    || ((status === 'not started' || status === 'error') && !!selectedAgent?.downloaded))
    && !isSending
    && !isHistoryReplaying
    && !elicitationRequest
    && !pendingPromptRef.current;

  const canPreemptQueuedPrompts = status === 'prompting'
    && isSending
    && !isHistoryReplaying
    && !pendingPromptRef.current;

  const handleDrainQueuedPrompt = useCallback((prompt: QueuePromptDraft) => {
    const outgoingBlocks = pendingHandoffRef.current
      ? prependHandoffContext(prompt.blocks, pendingHandoffRef.current.text, pendingHandoffRef.current.sourceConversationTitle)
      : prompt.blocks;
    sendPreparedPrompt(prompt, outgoingBlocks);
  }, [sendPreparedPrompt]);

  const preemptActivePromptForQueue = useCallback(async () => {
    if (!canPreemptQueuedPrompts) return false;
    setPermissionQueue([]);
    try {
      await ACPBridge.cancelPrompt(conversationId);
      return true;
    } catch (error) {
      console.warn('[useChatSession] Failed to preempt active prompt:', error);
      const message = error instanceof Error ? error.message : String(error);
      failActivePromptLocally(`Cancel request was not delivered. ${message}`);
      return false;
    }
  }, [canPreemptQueuedPrompts, conversationId, failActivePromptLocally]);

  const {
    queuedPrompts,
    enqueuePrompt,
    clearQueue,
    removeQueuedPrompt,
    takeQueuedPrompt,
    reorderQueuedPrompt,
    sendQueuedPromptNow,
  } = usePromptQueue({
    canDrain: canDrainQueuedPrompts,
    canPreempt: canPreemptQueuedPrompts,
    onDrain: handleDrainQueuedPrompt,
    onPreempt: preemptActivePromptForQueue,
    initialItems: restoredState?.queuedPrompts,
  });

  const workspaceStateRef = useRef<ChatWorkspaceState>();
  workspaceStateRef.current = {
    inputValue,
    attachments,
    scheduleEnabled,
    scheduledAt,
    approvalMode,
    configValues,
    queuedPrompts,
  };
  useEffect(() => uiWorkspace.registerChat(conversationId, () => {
    const state = workspaceStateRef.current!;
    const pending = pendingPromptRef.current;
    // The agent has not received the held prompt, so the UI that continues the chat sends it.
    return pending ? { ...state, queuedPrompts: [asQueuedPrompt(pending.draft), ...state.queuedPrompts] } : state;
  }), [conversationId]);
  useEffect(uiWorkspace.changed, [inputValue, attachments, scheduleEnabled, scheduledAt, approvalMode, configValues]);
  useEffect(uiWorkspace.saveSoon, [queuedPrompts, isSending]);

  const editQueuedPrompt = useCallback((id: string) => {
    const prompt = takeQueuedPrompt(id);
    if (!prompt) return;
    setInputValue(prompt.composerText);
    setAttachments([...prompt.attachments]);
    restoreConfigValues(prompt.configValues);
    setScheduleEnabled(prompt.scheduledAt !== undefined);
    setScheduledAt(prompt.scheduledAt);
    setQueueError('');
    setComposerLoadRevision((revision) => revision + 1);
  }, [restoreConfigValues, takeQueuedPrompt]);

  const setScheduleMode = useCallback((enabled: boolean) => {
    setScheduleEnabled(enabled);
    setScheduledAt(enabled ? new Date().setSeconds(0, 0) : undefined);
  }, []);

  const handleSend = useCallback(() => {
    const time = scheduleEnabled && scheduledAt !== undefined && scheduledAt > Date.now() ? scheduledAt : undefined;
    const text = inputValue.trim();
    if (!text && attachments.length === 0) return;

    const normalizedBlocks = normalizeOutgoingBlocks(buildPromptBlocks(inputValue, attachments));
    if (normalizedBlocks.length === 0) return;
    const draft: QueuePromptDraft = {
      agentId: selectedAgentId,
      agentName: adapterDisplayName,
      configValues: { ...configValues },
      configOptions: selectedConfigOptions.map((option) => ({ ...option })),
      text: plainTextFromBlocks(normalizedBlocks),
      composerText: inputValue,
      blocks: normalizedBlocks,
      attachments,
      scheduledAt: time,
    };
    if (time !== undefined || isSending || status === 'prompting') {
      if (!enqueuePrompt(draft)) {
        setQueueError('The queue is full. Remove a message before adding another.');
        return;
      }
    } else {
      handleDrainQueuedPrompt(draft);
    }
    setQueueError('');
    setInputValue('');
    setAttachments([]);
    setScheduledAt(scheduleEnabled ? new Date().setSeconds(0, 0) : undefined);
    if (scheduleEnabled) setScheduleDraftRevision((revision) => revision + 1);
  }, [adapterDisplayName, attachments, configValues, enqueuePrompt, handleDrainQueuedPrompt, inputValue, isSending, scheduleEnabled, scheduledAt, selectedAgentId, selectedConfigOptions, status]);

  const handleStop = () => {
    clearQueue();
    setQueueError('');

    if (pendingPromptRef.current && status !== 'prompting') {
      pendingPromptRef.current = null;
      setPermissionQueue([]);
      startTimeRef.current = null;
      setIsSending(false);
      setLiveMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage?.role === 'assistant' && !lastMessage.metaComplete && !(lastMessage.content || '').trim()) {
          return prev.slice(0, -1);
        }
        return prev;
      });
      return;
    }

    if (status === 'prompting') {
      const liveUserMessageCount = liveMessages.filter((message) => message.role === 'user').length;
      resetSessionAfterInitialCancelRef.current = !historySession && liveUserMessageCount === 1;
      setPermissionQueue([]);
      ACPBridge.cancelPrompt(conversationId).catch((error) => {
        console.warn('[useChatSession] Failed to cancel prompt:', error);
        const message = error instanceof Error ? error.message : String(error);
        failActivePromptLocally(`Cancel request was not delivered. ${message}`);
      });
    }
  };

  useEffect(() => {
    if (approvalMode !== 'auto' || !permissionRequest) return;

    const approveOption = findAutoApproveOption(permissionRequest);
    if (!approveOption) return;

    try {
      if (respondToPermission(permissionRequest, approveOption.optionId)) {
        setPermissionQueue((prev) => prev.filter((request) => request.requestId !== permissionRequest.requestId));
      }
    } catch (e) {
      console.warn('[useChatSession] Failed to auto-respond to permission:', e);
    }
  }, [approvalMode, permissionRequest]);

  const handlePermissionDecision = (decision: string) => {
    if (!permissionRequest) return;
    try {
      respondToPermission(permissionRequest, decision);
      // Dequeue the answered request; if more are pending the next one becomes visible automatically.
      setPermissionQueue((prev) => prev.slice(1));
    } catch (e) {
      console.warn('[useChatSession] Failed to respond to permission:', e);
    }
  };

  return {
    messages,
    inputValue,
    setInputValue,
    scheduleEnabled,
    setScheduleMode,
    scheduledAt,
    setScheduledAt,
    scheduleDraftRevision,
    queueError,
    composerLoadRevision,
    status,
    isSending,
    isHistoryReplaying,
    queuedPrompts,
    removeQueuedPrompt,
    editQueuedPrompt,
    reorderQueuedPrompt,
    sendQueuedPromptNow,
    selectedAgentId,
    agentOptions,
    selectedModelId,
    handleModelChange,
    selectedModeId,
    modeOptions,
    handleModeChange,
    selectedReasoningEffortId,
    reasoningEffortOptions,
    handleReasoningEffortChange,
    additionalConfigOptions,
    handleConfigOptionChange,
    approvalMode,
    setApprovalMode,
    permissionRequest,
    elicitationRequest,
    handleSend,
    handleStop,
    handlePermissionDecision,
    hasSelectedAgent: !!resolvedSelectedAgent,
    attachments,
    setAttachments,
    availableCommands,
    acpSessionId,
    adapterDisplayName,
    adapterIconPath: resolvedSelectedAgent?.iconPath || ''
  };
}
