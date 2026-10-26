import {
  AvailableCommand,
  AudioTranscriptionSettings,
  AudioTranscriptionResultPayload,
  BridgeOperationResultPayload,
  ChatAttachment,
  ConfigLinks,
  ContinueConversationPayload,
  ConversationTranscriptSavedPayload,
  FileChangeOperation,
  FileChangeStatsResultPayload,
  ForkConversationBase,
  GlobalSettingsPayload,
  SessionMetadataUpdatePayload,
  ToolCallEvent,
} from '../types/chat';
import { browserMicrophone } from './browserMicrophone';
import { extractToolCallDiffEntries, ToolCallRawInputCache } from './toolCallUtils';
import { McpServerConfig } from '../types/mcp';
import { CustomAcpConfig } from '../types/customAcp';
import { PromptLibraryItem } from '../types/promptLibrary';
import { SystemInstruction } from '../types/systemInstructions';
import {
  AdapterDeletedEvent,
  AdaptersEvent,
  AssistantActivityEvent,
  AudioRecordingStateEvent,
  AudioTranscriptionFeatureEvent,
  AudioTranscriptionResultEvent,
  AvailableCommandsEvent,
  BridgeOperationResultEvent,
  ChangesStateEvent,
  ChatAttachedEvent,
  ContentChunkEvent,
  ConversationReplayLoadedEvent,
  ConversationTranscriptSavedEvent,
  EVENT_NAMES,
  FileChangeStatsEvent,
  FilesResultEvent,
  GlobalSettingsEvent,
  HistoryDeleteResultEvent,
  HistoryListEvent,
  HistorySearchResultEvent,
  McpServersEvent,
  McpStatusEvent,
  CustomAcpConfigsEvent,
  CustomAcpStatusEvent,
  ModeEvent,
  PermissionRequestEvent,
  PromptLibraryEvent,
  SessionIdEvent,
  SessionConfigOptionsEvent,
  SpeechResultEvent,
  StatusEvent,
  SystemInstructionsEvent,
  ToolCallBridgeEvent,
  UndoResultEvent,
  onBridgeEvent,
} from './bridgeEvents';

let bridgeRequestCounter = 0;
let latestGlobalSettings: GlobalSettingsPayload | undefined;
const availableCommandsByAdapter = new Map<string, AvailableCommand[]>();
const pendingRpcMethodsById = new Map<string | number, string>();
const toolCallRawInputCache = new ToolCallRawInputCache();
const BRIDGE_REQUEST_TIMEOUT_MS = 120_000;
const BRIDGE_OPERATION_TIMEOUT_MS = 10_000;
const CANCEL_PROMPT_OPERATION_TIMEOUT_MS = 15_000;

function nextBridgeRequestId(prefix: string): string {
  bridgeRequestCounter += 1;
  return `${prefix}-${bridgeRequestCounter}-${Date.now()}`;
}

/** Invokes a bridge function and resolves with the backend response carrying the same request ID. */
function awaitBridgeResponse<P extends { requestId: string }>(
  subscribe: (callback: (e: CustomEvent<{ payload: P }>) => void) => () => void,
  requestId: string,
  invoke: () => void,
  options: {
    timeoutMs: number;
    timeoutMessage: string;
    /** Returns the rejection message for a failed response. */
    failure?: (payload: P) => string | undefined;
    onTimeout?: () => void;
  },
): Promise<P> {
  return new Promise((resolve, reject) => {
    let cleanup = () => {};
    const timeout = window.setTimeout(() => {
      options.onTimeout?.();
      cleanup();
      reject(new Error(options.timeoutMessage));
    }, options.timeoutMs);

    cleanup = subscribe((e) => {
      const payload = e.detail.payload;
      if (payload.requestId !== requestId) return;
      window.clearTimeout(timeout);
      cleanup();
      const error = options.failure?.(payload);
      if (error === undefined) {
        resolve(payload);
        return;
      }
      reject(new Error(error));
    });

    try {
      invoke();
    } catch (error) {
      window.clearTimeout(timeout);
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function awaitBridgeOperation(
  operation: BridgeOperationResultPayload['operation'],
  invoke: (requestId: string) => void,
  timeoutMs = BRIDGE_OPERATION_TIMEOUT_MS,
): Promise<void> {
  const requestId = nextBridgeRequestId(operation);
  await awaitBridgeResponse(ACPBridge.onBridgeOperationResult, requestId, () => invoke(requestId), {
    timeoutMs,
    timeoutMessage: `Bridge request '${operation}' was not acknowledged. Connection to the agent may be broken.`,
    failure: (payload) => (payload.ok ? undefined : payload.error || `Bridge request '${operation}' failed.`),
  });
}

const FILE_ICON_REQUEST_TIMEOUT_MS = 5_000;
const FILE_ICON_CACHE_LIMIT = 512;
const fileIconCache = new Map<string, string>();
const pendingFileIconRequests = new Map<string, Promise<string | null>>();
// Bumped on theme change so icons resolved against the previous theme are not cached.
let fileIconEpoch = 0;

export const ACPBridge = {
  initialize: () => {
    if (typeof window === 'undefined') return;

    window.__onContentChunk = (chunk) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.CONTENT_CHUNK, { detail: { chunk } }));

      if (chunk.type === 'tool_call' || chunk.type === 'tool_call_update') {
        try {
          const raw = chunk.toolRawJson ? JSON.parse(chunk.toolRawJson) : {};
          const toolCallId = chunk.toolCallId || raw.toolCallId || '';
          if (chunk.type === 'tool_call' && toolCallId && raw.rawInput && typeof raw.rawInput === 'object') {
            toolCallRawInputCache.set(chunk.chatId, toolCallId, raw.rawInput);
          }
          const diffs = extractToolCallDiffEntries(
            raw,
            toolCallId ? toolCallRawInputCache.get(chunk.chatId, toolCallId) : undefined
          )
            .map((diff) => ({ path: diff.path, oldText: diff.oldText, newText: diff.newText }));
          const status = chunk.toolStatus || raw.status;
          if (diffs.length > 0) {
            const payload: ToolCallEvent = {
              toolCallId,
              title: chunk.toolTitle || raw.title || '',
              kind: chunk.toolKind || raw.kind,
              status,
              diffs,
              locations: raw.locations,
            };
            const eventName = chunk.type === 'tool_call' ? EVENT_NAMES.TOOL_CALL : EVENT_NAMES.TOOL_CALL_UPDATE;
            window.dispatchEvent(new CustomEvent(eventName, { detail: { chatId: chunk.chatId, payload } }));
          } else if (toolCallId && status) {
            const payload: ToolCallEvent = {
              toolCallId,
              title: chunk.toolTitle || raw.title || '',
              kind: chunk.toolKind || raw.kind,
              status,
              diffs: [],
            };
            const eventName = chunk.type === 'tool_call' ? EVENT_NAMES.TOOL_CALL : EVENT_NAMES.TOOL_CALL_UPDATE;
            window.dispatchEvent(new CustomEvent(eventName, { detail: { chatId: chunk.chatId, payload } }));
          }
          if (toolCallId && status && !['pending', 'running', 'in_progress', 'active'].includes(String(status).toLowerCase())) {
            toolCallRawInputCache.delete(chunk.chatId, toolCallId);
          }
        } catch (e) {
          console.warn('[bridge] Failed to process tool call chunk', e);
        }
      }
    };

    window.__onStatus = (chatId, status) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.STATUS, { detail: { chatId, status } }));
    };

    window.__onAssistantActivity = (chatId) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.ASSISTANT_ACTIVITY, { detail: { chatId } }));
    };

    window.__onBridgeOperationResult = (payload) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.BRIDGE_OPERATION_RESULT, { detail: { payload } }));
    };

    window.__onSessionId = (chatId, id) => {
      toolCallRawInputCache.rememberSession(chatId, id);
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.SESSION_ID, { detail: { chatId, sessionId: id } }));
    };

    window.__onMode = (chatId, modeId) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.MODE, { detail: { chatId, modeId } }));
    };

    window.__onSessionConfigOptions = (payload) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.SESSION_CONFIG_OPTIONS, { detail: { payload } }));
    };

    window.__onAdapters = (adapters) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.ADAPTERS, { detail: { adapters } }));
    };

    window.__onAvailableCommands = (adapterId, commands) => {
      availableCommandsByAdapter.set(adapterId, commands);
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.AVAILABLE_COMMANDS, { detail: { adapterId, commands } }));
    };

    window.__onUsageData = (adapterId, json) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.USAGE_DATA, { detail: { adapterId, json } }));
    };

    window.__onPermissionRequest = (request) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.PERMISSION, { detail: { request } }));
    };

    window.__onAcpLog = (payload) => {
      const isDev = !!(window as any).__IS_DEV;
      let parsed: unknown = payload.json;
      if (payload.category === 'PROTOCOL') {
        try {
          parsed = JSON.parse(payload.json);
        } catch (_) {}
        const endpointDirection = payload.direction === 'SENT' ? 'TO' : 'FROM';
        if (isDev) console.log('[ACP JSON]', payload.direction, endpointDirection, payload.adapterId, parsed);

        const message = parsed as Record<string, any> | null;
        if (message && typeof message === 'object') {
          const id = message.id;
          const method = typeof message.method === 'string' ? message.method : null;

          if (payload.direction === 'SENT' && id !== undefined && method) {
            pendingRpcMethodsById.set(id, method);
            if (isDev && method === 'session/load') {
              console.log('[ACP TRACE] session/load started', { id, request: message });
            }
          }

          if (payload.direction === 'RECEIVED' && id !== undefined) {
            const pendingMethod = pendingRpcMethodsById.get(id);
            if (isDev && pendingMethod === 'session/load') {
              console.log('[ACP TRACE] session/load completed', { id, response: message });
            }
            if (pendingMethod) {
              pendingRpcMethodsById.delete(id);
            }
          }
        }
      }
    };

    window.__onHistoryList = (list) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.HISTORY_LIST, { detail: { list } }));
    };

    window.__onHistoryDeleteResult = (result) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.HISTORY_DELETE_RESULT, { detail: { result } }));
    };

    window.__onHistorySearchResult = (result) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.HISTORY_SEARCH_RESULT, { detail: { result } }));
    };

    window.__onUndoResult = (chatId, result) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.UNDO_RESULT, { detail: { chatId, result } }));
    };

    window.__onChangesState = (chatId, state) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.CHANGES_STATE, { detail: { chatId, state } }));
    };

    window.__onFileChangeStats = (payload) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.FILE_CHANGE_STATS, { detail: { payload } }));
    };

    window.__onAttachmentsAdded = (chatId, files) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.ATTACHMENTS_ADDED, { detail: { chatId, files } }));
    };

    window.__onConversationTranscriptSaved = (payload) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.CONVERSATION_TRANSCRIPT_SAVED, { detail: { payload } }));
    };

    window.__onConversationReplayLoaded = (payload) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.CONVERSATION_REPLAY_LOADED, { detail: { payload } }));
    };

    window.__onChatAttached = (payload) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.CHAT_ATTACHED, { detail: { payload } }));
    };

    window.__onMcpServers = (servers) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.MCP_SERVERS, { detail: { servers } }));
    };

    window.__onCustomAcpConfigs = (configs) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.CUSTOM_ACP_CONFIGS, { detail: { configs } }));
    };

    window.__onCustomAcpStatus = (update) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.CUSTOM_ACP_STATUS, { detail: { update } }));
    };

    window.__onMcpStatus = (update) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.MCP_STATUS, { detail: { update } }));
    };

    window.__onPromptLibrary = (items) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.PROMPT_LIBRARY, { detail: { items } }));
    };

    window.__onSystemInstructions = (instructions) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.SYSTEM_INSTRUCTIONS, { detail: { instructions } }));
    };

    window.__onAudioTranscriptionFeature = (state) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.AUDIO_TRANSCRIPTION_FEATURE, { detail: { state } }));
    };

    window.__onAudioTranscriptionResult = (payload) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.AUDIO_TRANSCRIPTION_RESULT, { detail: { payload } }));
    };

    window.__onAudioRecordingState = (payload) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.AUDIO_RECORDING_STATE, { detail: { payload } }));
    };

    window.__onSpeechResult = (payload) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.SPEECH_RESULT, { detail: { payload } }));
    };

    window.__onGlobalSettings = (payload) => {
      latestGlobalSettings = payload;
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.GLOBAL_SETTINGS, { detail: { payload } }));
    };

    window.__onAdapterDeleted = (adapterId) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.ADAPTER_DELETED, { detail: { adapterId } }));
    };

    window.__onFileIconResult = (result) => {
      window.dispatchEvent(new CustomEvent('acp-file-icon-result', { detail: result }));
    };

    window.__onThemeChanged = () => {
      fileIconEpoch += 1;
      fileIconCache.clear();
      window.dispatchEvent(new CustomEvent('acp-theme-changed'));
    };

    window.__onFilesResult = (payload) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.FILES_RESULT, { detail: { payload } }));
    };

    if (window.__notifyReady) window.__notifyReady();
  },

  onContentChunk: (callback: (e: CustomEvent<ContentChunkEvent>) => void) => onBridgeEvent(EVENT_NAMES.CONTENT_CHUNK, callback),

  onStatus: (callback: (e: CustomEvent<StatusEvent>) => void) => onBridgeEvent(EVENT_NAMES.STATUS, callback),

  onAssistantActivity: (callback: (e: CustomEvent<AssistantActivityEvent>) => void) =>
    onBridgeEvent(EVENT_NAMES.ASSISTANT_ACTIVITY, callback),

  onBridgeOperationResult: (callback: (e: CustomEvent<BridgeOperationResultEvent>) => void) => onBridgeEvent(EVENT_NAMES.BRIDGE_OPERATION_RESULT, callback),

  onSessionId: (callback: (e: CustomEvent<SessionIdEvent>) => void) => onBridgeEvent(EVENT_NAMES.SESSION_ID, callback),

  onMode: (callback: (e: CustomEvent<ModeEvent>) => void) => onBridgeEvent(EVENT_NAMES.MODE, callback),
  onSessionConfigOptions: (callback: (e: CustomEvent<SessionConfigOptionsEvent>) => void) =>
    onBridgeEvent(EVENT_NAMES.SESSION_CONFIG_OPTIONS, callback),

  onAdapters: (callback: (e: CustomEvent<AdaptersEvent>) => void) => onBridgeEvent(EVENT_NAMES.ADAPTERS, callback),

  onAvailableCommands: (callback: (e: CustomEvent<AvailableCommandsEvent>) => void) => onBridgeEvent(EVENT_NAMES.AVAILABLE_COMMANDS, callback),

  getAvailableCommands: (adapterId: string) => {
    return availableCommandsByAdapter.get(adapterId) ?? [];
  },

  onPermissionRequest: (callback: (e: CustomEvent<PermissionRequestEvent>) => void) => onBridgeEvent(EVENT_NAMES.PERMISSION, callback),

  /** Lists the adapters; with an id, restarts that adapter's status checks. */
  requestAdapters: (adapterIdToRefresh?: string) => {
    window.__requestAdapters?.(adapterIdToRefresh);
  },

  rememberAgentConfigOptions: (adapterId: string, configValues: Record<string, string>, links?: ConfigLinks) => {
    window.__rememberAgentConfigOptions?.(adapterId, configValues, links);
  },

  startAgent: (conversationId: string, adapterId?: string, configValues?: Record<string, string>) => {
    if (typeof window.__startAgent !== 'function') {
      return Promise.reject(new Error('Start agent bridge is not available.'));
    }
    return awaitBridgeOperation('start_agent', (requestId) => {
      window.__startAgent?.(conversationId, adapterId, configValues, requestId);
    });
  },

  sendPrompt: (
    conversationId: string,
    message: string,
    forkBase?: ForkConversationBase,
    adapterId?: string,
    configValues?: Record<string, string>
  ) => {
    if (typeof window.__sendPrompt !== 'function') {
      return Promise.reject(new Error('Send prompt bridge is not available.'));
    }
    return awaitBridgeOperation('send_prompt', (requestId) => {
      window.__sendPrompt?.(conversationId, message, requestId, forkBase, adapterId, configValues);
    });
  },

  cancelPrompt: (conversationId: string) => {
    if (typeof window.__cancelPrompt !== 'function') {
      return Promise.reject(new Error('Cancel prompt bridge is not available.'));
    }
    return awaitBridgeOperation(
      'cancel_prompt',
      (requestId) => {
        window.__cancelPrompt?.(conversationId, requestId);
      },
      CANCEL_PROMPT_OPERATION_TIMEOUT_MS,
    );
  },

  clearConversationToolCache: (conversationId: string) => {
    toolCallRawInputCache.clearChat(conversationId);
  },

  /** `view`: the user opened a view showing the data, so a recently cached value is enough. */
  fetchAdapterUsage: (adapterId: string, view?: boolean) => {
    window.__fetchAdapterUsage?.(adapterId, view);
  },

  cancelAgentInstall: (adapterId: string) => {
    window.__cancelAgentInstall?.(adapterId);
  },

  onUsageData: (callback: (e: CustomEvent<{ adapterId: string; json: string }>) => void) => onBridgeEvent(EVENT_NAMES.USAGE_DATA, callback),

  requestHistoryList: (projectPath?: string) => {
    window.__requestHistoryList?.(projectPath);
  },

  syncHistoryList: (projectPath?: string) => {
    window.__syncHistoryList?.(projectPath);
  },

  onHistoryList: (callback: (e: CustomEvent<HistoryListEvent>) => void) => onBridgeEvent(EVENT_NAMES.HISTORY_LIST, callback),

  onHistoryDeleteResult: (callback: (e: CustomEvent<HistoryDeleteResultEvent>) => void) => onBridgeEvent(EVENT_NAMES.HISTORY_DELETE_RESULT, callback),

  onHistoryDeleteRequest: (callback: (e: CustomEvent<{ conversationIds: string[] }>) => void) => onBridgeEvent(EVENT_NAMES.HISTORY_DELETE_REQUEST, callback),

  loadHistoryConversation: (conversationId: string, projectPath: string, historyConversationId: string) => {
    window.__loadHistoryConversation?.(conversationId, projectPath, historyConversationId);
  },

  /** Asks for the chat as the backend knows it, for a UI taking it over; the answer is [onChatAttached]. */
  attachChat: (chatId: string, projectPath = '') => {
    window.__attachChat?.(chatId, projectPath);
  },

  deleteHistoryConversations: (projectPath: string, conversationIds: string[]) => {
    if (!window.__deleteHistoryConversations) return;
    window.dispatchEvent(new CustomEvent(EVENT_NAMES.HISTORY_DELETE_REQUEST, { detail: { conversationIds } }));
    window.__deleteHistoryConversations?.({ projectPath, conversationIds });
  },

  /** Sets the user's title, the pinned flag and/or the group (empty: ungrouped) of conversations in the history index. */
  updateHistoryConversations: (
    projectPath: string,
    conversationIds: string[],
    changes: { newTitle?: string; pinned?: boolean; archived?: boolean; group?: string }
  ) => {
    window.__updateHistoryConversations?.({ projectPath, conversationIds, ...changes });
  },

  /** Moves the group's conversations to `newGroup`; an empty one ungroups them. */
  renameHistoryGroup: (projectPath: string, group: string, newGroup: string) => {
    window.__renameHistoryGroup?.({ projectPath, group, newGroup });
  },

  /** Answered by `onHistorySearchResult` with the conversations having a word that starts with the query. */
  searchHistoryConversations: (projectPath: string, conversationIds: string[], query: string) => {
    window.__searchHistoryConversations?.({ projectPath, conversationIds, query });
  },

  onHistorySearchResult: (callback: (e: CustomEvent<HistorySearchResultEvent>) => void) =>
    onBridgeEvent(EVENT_NAMES.HISTORY_SEARCH_RESULT, callback),

  updateSessionMetadata: (payload: SessionMetadataUpdatePayload) => {
    window.__updateSessionMetadata?.(payload);
  },

  continueConversationWithSession: (payload: ContinueConversationPayload) => {
    window.__continueConversationWithSession?.(payload);
  },

  saveConversationTranscript: (conversationId: string, text: string): Promise<ConversationTranscriptSavedPayload> => {
    if (typeof window.__saveConversationTranscript !== 'function') {
      return Promise.reject(new Error('Transcript persistence bridge is not available.'));
    }
    const requestId = nextBridgeRequestId('transcript');
    return awaitBridgeResponse(
      ACPBridge.onConversationTranscriptSaved,
      requestId,
      () => window.__saveConversationTranscript?.(JSON.stringify({ requestId, conversationId, text })),
      {
        timeoutMs: BRIDGE_REQUEST_TIMEOUT_MS,
        timeoutMessage: 'Transcript persistence timed out.',
        failure: (payload) => (payload.success && payload.filePath ? undefined : payload.error || 'Failed to persist transcript.'),
      },
    );
  },

  openAgentCli: (adapterId: string) => {
    window.__openAgentCli?.(adapterId);
  },

  openHistoryConversationCli: (projectPath: string, conversationId: string) => {
    window.__openHistoryConversationCli?.({ projectPath, conversationId });
  },

  onUndoResult: (callback: (e: CustomEvent<UndoResultEvent>) => void) => onBridgeEvent(EVENT_NAMES.UNDO_RESULT, callback),

  onChangesState: (callback: (e: CustomEvent<ChangesStateEvent>) => void) => onBridgeEvent(EVENT_NAMES.CHANGES_STATE, callback),

  computeFileChangeStats: (files: {
    filePath: string;
    status: 'A' | 'M' | 'D';
    operations: FileChangeOperation[];
    allowDeleted: boolean;
  }[]): Promise<FileChangeStatsResultPayload> => {
    if (typeof window.__computeFileChangeStats !== 'function') {
      return Promise.reject(new Error('File change stats bridge is not available.'));
    }
    const requestId = nextBridgeRequestId('file-change-stats');
    return awaitBridgeResponse(
      ACPBridge.onFileChangeStats,
      requestId,
      () => window.__computeFileChangeStats?.(JSON.stringify({ requestId, files })),
      { timeoutMs: BRIDGE_REQUEST_TIMEOUT_MS, timeoutMessage: 'File change stats request timed out.' },
    );
  },

  onToolCall: (callback: (e: CustomEvent<ToolCallBridgeEvent>) => void) => onBridgeEvent(EVENT_NAMES.TOOL_CALL, callback),

  onToolCallUpdate: (callback: (e: CustomEvent<ToolCallBridgeEvent>) => void) => onBridgeEvent(EVENT_NAMES.TOOL_CALL_UPDATE, callback),

  onFileChangeStats: (callback: (e: CustomEvent<FileChangeStatsEvent>) => void) => onBridgeEvent(EVENT_NAMES.FILE_CHANGE_STATS, callback),

  onAttachmentsAdded: (callback: (e: CustomEvent<{ chatId: string; files: ChatAttachment[] }>) => void) => onBridgeEvent(EVENT_NAMES.ATTACHMENTS_ADDED, callback),

  onConversationTranscriptSaved: (callback: (e: CustomEvent<ConversationTranscriptSavedEvent>) => void) => onBridgeEvent(EVENT_NAMES.CONVERSATION_TRANSCRIPT_SAVED, callback),

  onConversationReplayLoaded: (callback: (e: CustomEvent<ConversationReplayLoadedEvent>) => void) => onBridgeEvent(EVENT_NAMES.CONVERSATION_REPLAY_LOADED, callback),

  onChatAttached: (callback: (e: CustomEvent<ChatAttachedEvent>) => void) => onBridgeEvent(EVENT_NAMES.CHAT_ATTACHED, callback),

  /** Starts a file search and returns its request ID, which the result carries. */
  searchFiles: (query: string): string => {
    const requestId = nextBridgeRequestId('file-search');
    window.__searchFiles?.(JSON.stringify({ requestId, query }));
    return requestId;
  },

  onFilesResult: (callback: (e: CustomEvent<FilesResultEvent>) => void) => onBridgeEvent(EVENT_NAMES.FILES_RESULT, callback),

  requestFileIcon: (path: string): Promise<string | null> => {
    const cached = fileIconCache.get(path);
    if (cached) return Promise.resolve(cached);

    const pending = pendingFileIconRequests.get(path);
    if (pending) return pending;

    const requestEpoch = fileIconEpoch;
    const request = new Promise<string | null>((resolve) => {
      let timeout: number | undefined;

      const finish = (icon: string | null) => {
        window.clearTimeout(timeout);
        window.removeEventListener('acp-file-icon-result', handler);
        if (icon && requestEpoch === fileIconEpoch) {
          const oldest = fileIconCache.size >= FILE_ICON_CACHE_LIMIT ? fileIconCache.keys().next().value : undefined;
          if (oldest !== undefined) fileIconCache.delete(oldest);
          fileIconCache.set(path, icon);
        }
        resolve(icon);
      };

      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail as { path: string; icon: string };
        if (detail?.path === path) finish(detail.icon || null);
      };

      window.addEventListener('acp-file-icon-result', handler);
      timeout = window.setTimeout(() => finish(null), FILE_ICON_REQUEST_TIMEOUT_MS);
      if (typeof window.__requestFileIcon === 'function') window.__requestFileIcon(path);
      else finish(null);
    });

    pendingFileIconRequests.set(path, request);
    void request.then(() => {
      if (pendingFileIconRequests.get(path) === request) pendingFileIconRequests.delete(path);
    });
    return request;
  },

  onThemeChanged: (callback: () => void) => {
    window.addEventListener('acp-theme-changed', callback);
    return () => window.removeEventListener('acp-theme-changed', callback);
  },

  loadMcpServers: () => {
    window.__loadMcpServers?.();
  },

  saveMcpServers: (servers: McpServerConfig[]) => {
    window.__saveMcpServers?.(JSON.stringify(servers));
  },

  onMcpServers: (callback: (e: CustomEvent<McpServersEvent>) => void) => onBridgeEvent(EVENT_NAMES.MCP_SERVERS, callback),

  loadCustomAcpConfigs: () => {
    window.__loadCustomAcpConfigs?.();
  },

  saveCustomAcpConfigs: (configs: CustomAcpConfig[]) => {
    window.__saveCustomAcpConfigs?.(JSON.stringify(configs));
  },

  onCustomAcpConfigs: (callback: (e: CustomEvent<CustomAcpConfigsEvent>) => void) =>
    onBridgeEvent(EVENT_NAMES.CUSTOM_ACP_CONFIGS, callback),

  testCustomAcpConnection: (id: string, requestId: string) => {
    window.__testCustomAcpConnection?.(JSON.stringify({ id, requestId }));
  },

  cancelCustomAcpConnectionTest: (id: string) => {
    window.__cancelCustomAcpConnectionTest?.(id);
  },

  onCustomAcpStatus: (callback: (e: CustomEvent<CustomAcpStatusEvent>) => void) =>
    onBridgeEvent(EVENT_NAMES.CUSTOM_ACP_STATUS, callback),

  checkMcpStatus: (id: string) => {
    window.__checkMcpStatus?.(id);
  },

  cancelMcpStatus: (id: string) => {
    window.__cancelMcpStatus?.(id);
  },

  onMcpStatus: (callback: (e: CustomEvent<McpStatusEvent>) => void) => onBridgeEvent(EVENT_NAMES.MCP_STATUS, callback),

  loadPromptLibrary: () => {
    window.__loadPromptLibrary?.();
  },

  savePromptLibrary: (items: PromptLibraryItem[]) => {
    window.__savePromptLibrary?.(JSON.stringify(items));
  },

  onPromptLibrary: (callback: (e: CustomEvent<PromptLibraryEvent>) => void) => onBridgeEvent(EVENT_NAMES.PROMPT_LIBRARY, callback),

  loadSystemInstructions: () => {
    window.__loadSystemInstructions?.();
  },

  saveSystemInstructions: (instructions: SystemInstruction[]) => {
    window.__saveSystemInstructions?.(JSON.stringify(instructions));
  },

  onSystemInstructions: (callback: (e: CustomEvent<SystemInstructionsEvent>) => void) => onBridgeEvent(EVENT_NAMES.SYSTEM_INSTRUCTIONS, callback),

  loadAudioTranscriptionFeature: (settings: AudioTranscriptionSettings) => {
    window.__loadAudioTranscriptionFeature?.(JSON.stringify(settings));
  },

  installAudioTranscriptionFeature: (settings: AudioTranscriptionSettings) => {
    window.__installAudioTranscriptionFeature?.(JSON.stringify(settings));
  },

  cancelAudioTranscriptionFeatureInstall: (settings: AudioTranscriptionSettings) => {
    window.__cancelAudioTranscriptionFeatureInstall?.(JSON.stringify(settings));
  },

  uninstallAudioTranscriptionFeature: (settings: AudioTranscriptionSettings) => {
    window.__uninstallAudioTranscriptionFeature?.(JSON.stringify(settings));
  },

  onAudioTranscriptionFeature: (callback: (e: CustomEvent<AudioTranscriptionFeatureEvent>) => void) => onBridgeEvent(EVENT_NAMES.AUDIO_TRANSCRIPTION_FEATURE, callback),

  onAudioTranscriptionResult: (callback: (e: CustomEvent<AudioTranscriptionResultEvent>) => void) => onBridgeEvent(EVENT_NAMES.AUDIO_TRANSCRIPTION_RESULT, callback),

  // A web browser records with the microphone of the device showing the page, and the IDE transcribes the recording.
  startAudioRecording: (ownerId: string, recordingLimitSeconds: number) => {
    if (window.__AGENT_DOCK_CLIENT === 'browser') void browserMicrophone.start(ownerId);
    else window.__startAudioRecording?.(JSON.stringify({ ownerId, recordingLimitSeconds }));
  },

  stopAudioRecording: async (requestId: string, ownerId: string): Promise<AudioTranscriptionResultPayload> => {
    if (typeof window.__stopAudioRecording !== 'function') {
      throw new Error('Audio recording bridge is not available.');
    }
    const audio = window.__AGENT_DOCK_CLIENT === 'browser' ? await browserMicrophone.stop(ownerId) : undefined;
    if (audio === null) return { requestId, success: false, cancelled: true };
    return awaitBridgeResponse(
      ACPBridge.onAudioTranscriptionResult,
      requestId,
      () => window.__stopAudioRecording?.(JSON.stringify({ requestId, ownerId, audio })),
      {
        timeoutMs: 60_000,
        timeoutMessage: 'Audio transcription timed out.',
        failure: (payload) => (payload.cancelled || payload.success ? undefined : payload.error || 'Audio transcription failed'),
        onTimeout: () => {
          ACPBridge.cancelAudioTranscription(requestId);
          ACPBridge.cancelAudioRecording(ownerId);
        },
      },
    );
  },

  cancelAudioTranscription: (requestId: string) => {
    window.__cancelAudioTranscription?.(JSON.stringify({ requestId }));
  },

  cancelAudioRecording: (ownerId: string) => {
    browserMicrophone.cancel(ownerId);
    window.__cancelAudioRecording?.(ownerId);
  },

  onAudioRecordingState: (callback: (e: CustomEvent<AudioRecordingStateEvent>) => void) => onBridgeEvent(EVENT_NAMES.AUDIO_RECORDING_STATE, callback),

  startSpeech: (requestId: string, chunks: string[]) => {
    window.__startSpeech?.(JSON.stringify({ requestId, chunks }));
  },

  stopSpeech: (requestId: string) => {
    window.__stopSpeech?.(requestId);
  },

  onSpeechResult: (callback: (e: CustomEvent<SpeechResultEvent>) => void) => onBridgeEvent(EVENT_NAMES.SPEECH_RESULT, callback),

  loadGlobalSettings: () => {
    window.__loadGlobalSettings?.();
  },

  getGlobalSettingsSnapshot: () => latestGlobalSettings,

  /** Saves only the given fields; the backend keeps the saved value of every other one. */
  saveGlobalSettings: (changes: Partial<GlobalSettingsPayload['settings']>) => {
    window.__saveGlobalSettings?.(JSON.stringify(changes));
  },

  onGlobalSettings: (callback: (e: CustomEvent<GlobalSettingsEvent>) => void) => onBridgeEvent(EVENT_NAMES.GLOBAL_SETTINGS, callback),

  onAdapterDeleted: (callback: (e: CustomEvent<AdapterDeletedEvent>) => void) => onBridgeEvent(EVENT_NAMES.ADAPTER_DELETED, callback),
};
