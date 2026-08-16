import {
  AvailableCommand,
  AudioTranscriptionResultPayload,
  AudioTranscriptionSettings,
  BridgeOperationResultPayload,
  ChatAttachment,
  ContinueConversationPayload,
  ConversationTranscriptSavedPayload,
  FileChangeOperation,
  FileChangeStatsResultPayload,
  ForkConversationBase,
  GlobalSettingsPayload,
  SessionMetadataUpdatePayload,
  ToolCallEvent,
} from '../types/chat';
import { extractToolCallDiffEntries, ToolCallRawInputCache } from './toolCallUtils';
import { McpServerConfig } from '../types/mcp';
import { PromptLibraryItem } from '../types/promptLibrary';
import { SystemInstruction } from '../types/systemInstructions';
import {
  AdapterDeletedEvent,
  AdapterRefreshStateEvent,
  AdaptersEvent,
  AudioRecordingStateEvent,
  AudioTranscriptionFeatureEvent,
  AudioTranscriptionResultEvent,
  AudioTranscriptionSettingsEvent,
  AvailableCommandsEvent,
  BridgeOperationResultEvent,
  ChangesStateEvent,
  ContentChunkEvent,
  ConversationReplayLoadedEvent,
  ConversationTranscriptSavedEvent,
  EVENT_NAMES,
  FileChangeStatsEvent,
  GlobalSettingsEvent,
  HistoryDeleteResultEvent,
  HistoryListEvent,
  McpServersEvent,
  McpStatusEvent,
  ModeEvent,
  PermissionRequestEvent,
  PromptLibraryEvent,
  SessionIdEvent,
  SessionConfigOptionsEvent,
  StatusEvent,
  SystemInstructionsEvent,
  ToolCallBridgeEvent,
  UndoResultEvent,
  onBridgeEvent,
} from './bridgeEvents';

let saveTranscriptCounter = 0;
let audioTranscriptionCounter = 0;
let fileChangeStatsCounter = 0;
let bridgeOperationCounter = 0;
const availableCommandsByAdapter = new Map<string, AvailableCommand[]>();
const pendingRpcMethodsById = new Map<string | number, string>();
const toolCallRawInputCache = new ToolCallRawInputCache();
const BRIDGE_REQUEST_TIMEOUT_MS = 120_000;
const BRIDGE_OPERATION_TIMEOUT_MS = 10_000;
const CANCEL_PROMPT_OPERATION_TIMEOUT_MS = 15_000;

function nextSaveTranscriptRequestId(): string {
  saveTranscriptCounter += 1;
  return `transcript-${saveTranscriptCounter}-${Date.now()}`;
}

function nextAudioTranscriptionRequestId(): string {
  audioTranscriptionCounter += 1;
  return `audio-transcription-${audioTranscriptionCounter}-${Date.now()}`;
}

function nextFileChangeStatsRequestId(): string {
  fileChangeStatsCounter += 1;
  return `file-change-stats-${fileChangeStatsCounter}-${Date.now()}`;
}

function nextBridgeOperationRequestId(operation: string): string {
  bridgeOperationCounter += 1;
  return `${operation}-${bridgeOperationCounter}-${Date.now()}`;
}

function awaitBridgeOperation(
  operation: BridgeOperationResultPayload['operation'],
  invoke: (requestId: string) => void,
  timeoutMs = BRIDGE_OPERATION_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = nextBridgeOperationRequestId(operation);
    let cleanup = () => {};
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Bridge request '${operation}' was not acknowledged. Connection to the agent may be broken.`));
    }, timeoutMs);

    cleanup = ACPBridge.onBridgeOperationResult((e) => {
      const payload = e.detail.payload;
      if (payload.requestId !== requestId) return;
      window.clearTimeout(timeout);
      cleanup();
      if (payload.ok) {
        resolve();
        return;
      }
      reject(new Error(payload.error || `Bridge request '${operation}' failed.`));
    });

    try {
      invoke(requestId);
    } catch (error) {
      window.clearTimeout(timeout);
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
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
          } else if (chunk.type === 'tool_call_update' && toolCallId && status) {
            const payload: ToolCallEvent = {
              toolCallId,
              title: chunk.toolTitle || raw.title || '',
              kind: chunk.toolKind || raw.kind,
              status,
              diffs: [],
            };
            window.dispatchEvent(new CustomEvent(EVENT_NAMES.TOOL_CALL_UPDATE, { detail: { chatId: chunk.chatId, payload } }));
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

    window.__onAdapterRefreshState = (refreshing) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.ADAPTER_REFRESH_STATE, { detail: { refreshing } }));
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
      } else if (payload.category === 'INTERNAL') {
        if (isDev) console.log('[ACP INTERNAL]', payload.json);
      }

      window.dispatchEvent(new CustomEvent(EVENT_NAMES.LOG, { detail: payload }));
    };

    window.__onHistoryList = (list) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.HISTORY_LIST, { detail: { list } }));
    };

    window.__onHistoryDeleteResult = (result) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.HISTORY_DELETE_RESULT, { detail: { result } }));
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

    window.__onMcpServers = (servers) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.MCP_SERVERS, { detail: { servers } }));
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

    window.__onAudioTranscriptionSettings = (settings) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.AUDIO_TRANSCRIPTION_SETTINGS, { detail: { settings } }));
    };

    window.__onGlobalSettings = (payload) => {
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

    window.__onFilesResult = (filesJson) => {
      let files = [];
      try {
        files = typeof filesJson === "string" ? JSON.parse(filesJson) : filesJson;
      } catch (e) {
        console.warn('[bridge] Failed to parse files result', e);
      }
      window.dispatchEvent(new CustomEvent("acp-files-result", { detail: { files } }));
    };

    if (window.__notifyReady) window.__notifyReady();
  },

  onContentChunk: (callback: (e: CustomEvent<ContentChunkEvent>) => void) => onBridgeEvent(EVENT_NAMES.CONTENT_CHUNK, callback),

  onStatus: (callback: (e: CustomEvent<StatusEvent>) => void) => onBridgeEvent(EVENT_NAMES.STATUS, callback),

  onBridgeOperationResult: (callback: (e: CustomEvent<BridgeOperationResultEvent>) => void) => onBridgeEvent(EVENT_NAMES.BRIDGE_OPERATION_RESULT, callback),

  onSessionId: (callback: (e: CustomEvent<SessionIdEvent>) => void) => onBridgeEvent(EVENT_NAMES.SESSION_ID, callback),

  onMode: (callback: (e: CustomEvent<ModeEvent>) => void) => onBridgeEvent(EVENT_NAMES.MODE, callback),
  onSessionConfigOptions: (callback: (e: CustomEvent<SessionConfigOptionsEvent>) => void) =>
    onBridgeEvent(EVENT_NAMES.SESSION_CONFIG_OPTIONS, callback),

  onAdapters: (callback: (e: CustomEvent<AdaptersEvent>) => void) => onBridgeEvent(EVENT_NAMES.ADAPTERS, callback),

  onAdapterRefreshState: (callback: (e: CustomEvent<AdapterRefreshStateEvent>) => void) =>
    onBridgeEvent(EVENT_NAMES.ADAPTER_REFRESH_STATE, callback),

  onAvailableCommands: (callback: (e: CustomEvent<AvailableCommandsEvent>) => void) => onBridgeEvent(EVENT_NAMES.AVAILABLE_COMMANDS, callback),

  getAvailableCommands: (adapterId: string) => {
    return availableCommandsByAdapter.get(adapterId) ?? [];
  },

  onPermissionRequest: (callback: (e: CustomEvent<PermissionRequestEvent>) => void) => onBridgeEvent(EVENT_NAMES.PERMISSION, callback),

  requestAdapters: (forceRefresh = false) => {
    window.__requestAdapters?.(forceRefresh);
  },

  rememberAgentConfigOption: (adapterId: string, configId: string, value: string) => {
    window.__rememberAgentConfigOption?.(adapterId, configId, value);
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

  recoverRuntime: (reason?: string) => {
    if (typeof window.__recoverRuntime !== 'function') {
      return Promise.reject(new Error('Runtime recovery bridge is not available.'));
    }
    return awaitBridgeOperation('recover_runtime', (requestId) => {
      window.__recoverRuntime?.(reason, requestId);
    });
  },

  fetchAdapterUsage: (adapterId: string) => {
    window.__fetchAdapterUsage?.(adapterId);
  },

  cancelAgentInstall: (adapterId: string) => {
    window.__cancelAgentInstall?.(adapterId);
  },

  onUsageData: (callback: (e: CustomEvent<{ adapterId: string; json: string }>) => void) => onBridgeEvent(EVENT_NAMES.USAGE_DATA, callback),

  onLog: (callback: (e: CustomEvent) => void) => onBridgeEvent(EVENT_NAMES.LOG, callback),

  requestHistoryList: (projectPath?: string) => {
    window.__requestHistoryList?.(projectPath);
  },

  syncHistoryList: (projectPath?: string) => {
    window.__syncHistoryList?.(projectPath);
  },

  onHistoryList: (callback: (e: CustomEvent<HistoryListEvent>) => void) => onBridgeEvent(EVENT_NAMES.HISTORY_LIST, callback),

  onHistoryDeleteResult: (callback: (e: CustomEvent<HistoryDeleteResultEvent>) => void) => onBridgeEvent(EVENT_NAMES.HISTORY_DELETE_RESULT, callback),

  loadHistoryConversation: (conversationId: string, projectPath: string, historyConversationId: string) => {
    window.__loadHistoryConversation?.(conversationId, projectPath, historyConversationId);
  },

  deleteHistoryConversations: (projectPath: string, conversationIds: string[]) => {
    window.__deleteHistoryConversations?.({ projectPath, conversationIds });
  },

  renameHistoryConversation: (projectPath: string, conversationId: string, newTitle: string) => {
    window.__renameHistoryConversation?.({ projectPath, conversationId, newTitle });
  },

  updateSessionMetadata: (payload: SessionMetadataUpdatePayload) => {
    window.__updateSessionMetadata?.(payload);
  },

  continueConversationWithSession: (payload: ContinueConversationPayload) => {
    window.__continueConversationWithSession?.(payload);
  },

  saveConversationTranscript: (conversationId: string, text: string): Promise<ConversationTranscriptSavedPayload> => {
    return new Promise((resolve, reject) => {
      if (typeof window.__saveConversationTranscript !== 'function') {
        reject(new Error('Transcript persistence bridge is not available.'));
        return;
      }

      const requestId = nextSaveTranscriptRequestId();
      let cleanup = () => {};
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('Transcript persistence timed out.'));
      }, BRIDGE_REQUEST_TIMEOUT_MS);
      cleanup = ACPBridge.onConversationTranscriptSaved((e) => {
        const payload = e.detail.payload;
        if (payload.requestId !== requestId) return;
        window.clearTimeout(timeout);
        cleanup();
        if (payload.success && payload.filePath) {
          resolve(payload);
          return;
        }
        reject(new Error(payload.error || 'Failed to persist transcript.'));
      });

      try {
        window.__saveConversationTranscript(JSON.stringify({ requestId, conversationId, text }));
      } catch (error) {
        window.clearTimeout(timeout);
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  },

  openAgentCli: (adapterId: string) => {
    window.__openAgentCli?.(adapterId);
  },

  openHistoryConversationCli: (projectPath: string, conversationId: string) => {
    window.__openHistoryConversationCli?.({ projectPath, conversationId });
  },

  onUndoResult: (callback: (e: CustomEvent<UndoResultEvent>) => void) => onBridgeEvent(EVENT_NAMES.UNDO_RESULT, callback),

  onChangesState: (callback: (e: CustomEvent<ChangesStateEvent>) => void) => onBridgeEvent(EVENT_NAMES.CHANGES_STATE, callback),

  computeFileChangeStats: (files: { filePath: string; status: 'A' | 'M'; operations: FileChangeOperation[] }[]): Promise<FileChangeStatsResultPayload> => {
    return new Promise((resolve, reject) => {
      if (typeof window.__computeFileChangeStats !== 'function') {
        reject(new Error('File change stats bridge is not available.'));
        return;
      }

      const requestId = nextFileChangeStatsRequestId();
      let cleanup = () => {};
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('File change stats request timed out.'));
      }, BRIDGE_REQUEST_TIMEOUT_MS);
      cleanup = ACPBridge.onFileChangeStats((e) => {
        const payload = e.detail.payload;
        if (payload.requestId !== requestId) return;
        window.clearTimeout(timeout);
        cleanup();
        resolve(payload);
      });

      try {
        window.__computeFileChangeStats(JSON.stringify({ requestId, files }));
      } catch (error) {
        window.clearTimeout(timeout);
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  },

  onToolCall: (callback: (e: CustomEvent<ToolCallBridgeEvent>) => void) => onBridgeEvent(EVENT_NAMES.TOOL_CALL, callback),

  onToolCallUpdate: (callback: (e: CustomEvent<ToolCallBridgeEvent>) => void) => onBridgeEvent(EVENT_NAMES.TOOL_CALL_UPDATE, callback),

  onFileChangeStats: (callback: (e: CustomEvent<FileChangeStatsEvent>) => void) => onBridgeEvent(EVENT_NAMES.FILE_CHANGE_STATS, callback),

  onAttachmentsAdded: (callback: (e: CustomEvent<{ chatId: string; files: ChatAttachment[] }>) => void) => onBridgeEvent(EVENT_NAMES.ATTACHMENTS_ADDED, callback),

  onConversationTranscriptSaved: (callback: (e: CustomEvent<ConversationTranscriptSavedEvent>) => void) => onBridgeEvent(EVENT_NAMES.CONVERSATION_TRANSCRIPT_SAVED, callback),

  onConversationReplayLoaded: (callback: (e: CustomEvent<ConversationReplayLoadedEvent>) => void) => onBridgeEvent(EVENT_NAMES.CONVERSATION_REPLAY_LOADED, callback),

  searchFiles: (query: string) => {
    window.__searchFiles?.(query);
  },

  onFilesResult: (callback: (e: CustomEvent<{ files: { path: string, name: string }[] }>) => void) => {
    const fn = (e: Event) => callback(e as CustomEvent);
    window.addEventListener('acp-files-result', fn);
    return () => window.removeEventListener('acp-files-result', fn);
  },

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

  checkMcpStatus: () => {
    window.__checkMcpStatus?.();
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

  loadAudioTranscriptionFeature: () => {
    window.__loadAudioTranscriptionFeature?.();
  },

  installAudioTranscriptionFeature: () => {
    window.__installAudioTranscriptionFeature?.();
  },

  uninstallAudioTranscriptionFeature: () => {
    window.__uninstallAudioTranscriptionFeature?.();
  },

  onAudioTranscriptionFeature: (callback: (e: CustomEvent<AudioTranscriptionFeatureEvent>) => void) => onBridgeEvent(EVENT_NAMES.AUDIO_TRANSCRIPTION_FEATURE, callback),

  transcribeAudioInput: (audioBase64: string): Promise<AudioTranscriptionResultPayload> => {
    return new Promise((resolve, reject) => {
      if (typeof window.__transcribeAudioInput !== 'function') {
        reject(new Error('Audio transcription bridge is not available.'));
        return;
      }

      const requestId = nextAudioTranscriptionRequestId();
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Audio transcription timed out.'));
      }, 120_000);
      const cleanup = ACPBridge.onAudioTranscriptionResult((e) => {
        const payload = e.detail.payload;
        if (payload.requestId !== requestId) return;
        clearTimeout(timeout);
        cleanup();
        if (payload.success) {
          resolve(payload);
        } else {
          reject(new Error(payload.error || 'Audio transcription failed.'));
        }
      });

      try {
        window.__transcribeAudioInput(JSON.stringify({ requestId, audioBase64 }));
      } catch (error) {
        clearTimeout(timeout);
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  },

  onAudioTranscriptionResult: (callback: (e: CustomEvent<AudioTranscriptionResultEvent>) => void) => onBridgeEvent(EVENT_NAMES.AUDIO_TRANSCRIPTION_RESULT, callback),

  startAudioRecording: () => {
    window.__startAudioRecording?.();
  },

  stopAudioRecording: (requestId: string): Promise<AudioTranscriptionResultPayload> => {
    return new Promise((resolve, reject) => {
      if (typeof window.__stopAudioRecording !== 'function') {
        reject(new Error('Audio recording bridge is not available.'));
        return;
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Audio transcription timed out.'));
      }, 120_000);
      const cleanup = ACPBridge.onAudioTranscriptionResult((e) => {
        const payload = e.detail.payload;
        if (payload.requestId !== requestId) return;
        clearTimeout(timeout);
        cleanup();
        if (payload.success) {
          resolve(payload);
        } else {
          reject(new Error(payload.error || 'Audio transcription failed.'));
        }
      });

      try {
        window.__stopAudioRecording(JSON.stringify({ requestId }));
      } catch (error) {
        clearTimeout(timeout);
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  },

  onAudioRecordingState: (callback: (e: CustomEvent<AudioRecordingStateEvent>) => void) => onBridgeEvent(EVENT_NAMES.AUDIO_RECORDING_STATE, callback),

  loadAudioTranscriptionSettings: () => {
    window.__loadAudioTranscriptionSettings?.();
  },

  saveAudioTranscriptionSettings: (settings: AudioTranscriptionSettings) => {
    window.__saveAudioTranscriptionSettings?.(JSON.stringify(settings));
  },

  onAudioTranscriptionSettings: (callback: (e: CustomEvent<AudioTranscriptionSettingsEvent>) => void) => onBridgeEvent(EVENT_NAMES.AUDIO_TRANSCRIPTION_SETTINGS, callback),

  loadGlobalSettings: () => {
    window.__loadGlobalSettings?.();
  },

  saveGlobalSettings: (settings: GlobalSettingsPayload['settings']) => {
    window.__saveGlobalSettings?.(JSON.stringify(settings));
  },

  onGlobalSettings: (callback: (e: CustomEvent<GlobalSettingsEvent>) => void) => onBridgeEvent(EVENT_NAMES.GLOBAL_SETTINGS, callback),

  onAdapterDeleted: (callback: (e: CustomEvent<AdapterDeletedEvent>) => void) => onBridgeEvent(EVENT_NAMES.ADAPTER_DELETED, callback),
};
