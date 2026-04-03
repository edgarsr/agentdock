import {
  AgentOption,
  PermissionRequest,
  HistorySessionMeta,
  HistoryDeleteResultPayload,
  UndoResultPayload,
  ChangesState,
  ContentChunk,
  ToolCallEvent,
  ChatAttachment,
  SessionMetadataUpdatePayload,
  ContinueConversationPayload,
  ConversationTranscriptSavedPayload,
  AvailableCommand,
  AudioTranscriptionFeatureState,
  AudioTranscriptionResultPayload,
  AudioRecordingStatePayload,
  AudioTranscriptionSettings,
  ConversationReplayLoadedPayload,
  GlobalSettingsPayload,
  ExecutionTargetSwitchPayload,
  FileChangeOperation,
  FileChangeStatsResultPayload,
} from '../types/chat';
import { McpServerConfig } from '../types/mcp';
import { PromptLibraryItem } from '../types/promptLibrary';
import { SystemInstruction } from '../types/systemInstructions';

export interface ContentChunkEvent { chunk: ContentChunk; }
export interface StatusEvent { chatId: string; status: string; }
export interface SessionIdEvent { chatId: string; sessionId: string; }
export interface ModeEvent { chatId: string; modeId: string; }
export interface AdaptersEvent { adapters: AgentOption[]; }
export interface PermissionRequestEvent { request: PermissionRequest; }
export interface AvailableCommandsEvent { adapterId: string; commands: AvailableCommand[]; }
export interface HistoryListEvent { list: HistorySessionMeta[]; }
export interface HistoryDeleteResultEvent { result: HistoryDeleteResultPayload; }
export interface UndoResultEvent { chatId: string; result: UndoResultPayload; }
export interface ChangesStateEvent { chatId: string; state: ChangesState; }
export interface ToolCallBridgeEvent { chatId: string; payload: ToolCallEvent; }
export interface ConversationTranscriptSavedEvent { payload: ConversationTranscriptSavedPayload; }
export interface ConversationReplayLoadedEvent { payload: ConversationReplayLoadedPayload; }
export interface FileChangeStatsEvent { payload: FileChangeStatsResultPayload; }

export interface McpServersEvent { servers: McpServerConfig[]; }
export interface PromptLibraryEvent { items: PromptLibraryItem[]; }
export interface SystemInstructionsEvent { instructions: SystemInstruction[]; }
export interface AudioTranscriptionFeatureEvent { state: AudioTranscriptionFeatureState; }
export interface AudioTranscriptionResultEvent { payload: AudioTranscriptionResultPayload; }
export interface AudioRecordingStateEvent { payload: AudioRecordingStatePayload; }
export interface AudioTranscriptionSettingsEvent { settings: AudioTranscriptionSettings; }
export interface GlobalSettingsEvent { payload: GlobalSettingsPayload; }
export interface ExecutionTargetSwitchedEvent { payload: ExecutionTargetSwitchPayload; }

const EVENT_NAMES = {
  CONTENT_CHUNK: 'acp-content-chunk',
  MCP_SERVERS: 'mcp-servers',
  PROMPT_LIBRARY: 'prompt-library',
  SYSTEM_INSTRUCTIONS: 'system-instructions',
  STATUS: 'acp-status',
  SESSION_ID: 'acp-session-id',
  MODE: 'acp-mode',
  ADAPTERS: 'acp-adapters',
  AVAILABLE_COMMANDS: 'acp-available-commands',
  USAGE_DATA: 'acp-usage-data',
  PERMISSION: 'acp-permission',
  LOG: 'acp-log',
  HISTORY_LIST: 'history-list',
  HISTORY_DELETE_RESULT: 'history-delete-result',
  UNDO_RESULT: 'acp-undo-result',
  CHANGES_STATE: 'acp-changes-state',
  FILE_CHANGE_STATS: 'acp-file-change-stats',
  ATTACHMENTS_ADDED: 'acp-attachments-added',
  TOOL_CALL: 'acp-tool-call',
  TOOL_CALL_UPDATE: 'acp-tool-call-update',
  CONVERSATION_TRANSCRIPT_SAVED: 'conversation-transcript-saved',
  CONVERSATION_REPLAY_LOADED: 'conversation-replay-loaded',
  AUDIO_TRANSCRIPTION_FEATURE: 'audio-transcription-feature',
  AUDIO_TRANSCRIPTION_RESULT: 'audio-transcription-result',
  AUDIO_RECORDING_STATE: 'audio-recording-state',
  AUDIO_TRANSCRIPTION_SETTINGS: 'audio-transcription-settings',
  GLOBAL_SETTINGS: 'global-settings',
  EXECUTION_TARGET_SWITCHED: 'execution-target-switched',
};

let saveTranscriptCounter = 0;
let audioTranscriptionCounter = 0;
let fileChangeStatsCounter = 0;
const availableCommandsByAdapter = new Map<string, AvailableCommand[]>();

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

export const ACPBridge = {
  initialize: () => {
    if (typeof window === 'undefined') return;

    window.__onContentChunk = (chunk) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.CONTENT_CHUNK, { detail: { chunk } }));

      if (chunk.type === 'tool_call' || chunk.type === 'tool_call_update') {
        try {
          const raw = chunk.toolRawJson ? JSON.parse(chunk.toolRawJson) : {};
          const diffs = Array.isArray(raw.content)
            ? raw.content
                .filter((c: any) => c.type === 'diff' || (c.path !== undefined && c.newText !== undefined))
                .map((c: any) => ({ path: c.path, oldText: c.oldText ?? null, newText: c.newText ?? '' }))
            : (Array.isArray(raw.diffs) ? raw.diffs : []);
          if (diffs.length > 0) {
            const payload: ToolCallEvent = {
              toolCallId: chunk.toolCallId || raw.toolCallId || '',
              title: chunk.toolTitle || raw.title || '',
              kind: chunk.toolKind || raw.kind,
              status: chunk.toolStatus || raw.status,
              isReplay: chunk.isReplay,
              diffs,
              locations: raw.locations,
            };
            const eventName = chunk.type === 'tool_call' ? EVENT_NAMES.TOOL_CALL : EVENT_NAMES.TOOL_CALL_UPDATE;
            window.dispatchEvent(new CustomEvent(eventName, { detail: { chatId: chunk.chatId, payload } }));
          } else if (chunk.type === 'tool_call_update' && (chunk.toolCallId || raw.toolCallId) && (chunk.toolStatus || raw.status)) {
            const payload: ToolCallEvent = {
              toolCallId: chunk.toolCallId || raw.toolCallId || '',
              title: chunk.toolTitle || raw.title || '',
              kind: chunk.toolKind || raw.kind,
              status: chunk.toolStatus || raw.status,
              isReplay: chunk.isReplay,
              diffs: [],
            };
            window.dispatchEvent(new CustomEvent(EVENT_NAMES.TOOL_CALL_UPDATE, { detail: { chatId: chunk.chatId, payload } }));
          }
        } catch (_) {
        }
      }
    };

    window.__onStatus = (chatId, status) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.STATUS, { detail: { chatId, status } }));
    };

    window.__onSessionId = (chatId, id) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.SESSION_ID, { detail: { chatId, sessionId: id } }));
    };

    window.__onMode = (chatId, modeId) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.MODE, { detail: { chatId, modeId } }));
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
      let parsed: unknown = payload.json;
      if (payload.category === 'PROTOCOL') {
        try {
          parsed = JSON.parse(payload.json);
        } catch (_) {}
        console.log('[ACP JSON]', payload.direction, parsed);
      } else if (payload.category === 'INTERNAL') {
        console.log('[ACP INTERNAL]', payload.json);
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

    window.__onExecutionTargetSwitched = (payload) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.EXECUTION_TARGET_SWITCHED, { detail: { payload } }));
    };

    window.__onFilesResult = (filesJson) => {
      let files = [];
      try {
        files = typeof filesJson === "string" ? JSON.parse(filesJson) : filesJson;
      } catch (e) {}
      window.dispatchEvent(new CustomEvent("acp-files-result", { detail: { files } }));
    };

    if (window.__notifyReady) window.__notifyReady();
  },

  onContentChunk: (callback: (e: CustomEvent<ContentChunkEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.CONTENT_CHUNK, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.CONTENT_CHUNK, callback as EventListener);
  },

  onStatus: (callback: (e: CustomEvent<StatusEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.STATUS, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.STATUS, callback as EventListener);
  },

  onSessionId: (callback: (e: CustomEvent<SessionIdEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.SESSION_ID, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.SESSION_ID, callback as EventListener);
  },

  onMode: (callback: (e: CustomEvent<ModeEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.MODE, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.MODE, callback as EventListener);
  },

  onAdapters: (callback: (e: CustomEvent<AdaptersEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.ADAPTERS, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.ADAPTERS, callback as EventListener);
  },

  onAvailableCommands: (callback: (e: CustomEvent<AvailableCommandsEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.AVAILABLE_COMMANDS, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.AVAILABLE_COMMANDS, callback as EventListener);
  },

  getAvailableCommands: (adapterId: string) => {
    return availableCommandsByAdapter.get(adapterId) ?? [];
  },

  onPermissionRequest: (callback: (e: CustomEvent<PermissionRequestEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.PERMISSION, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.PERMISSION, callback as EventListener);
  },

  requestAdapters: () => {
    window.__requestAdapters?.();
  },

  fetchAdapterUsage: (adapterId: string) => {
    window.__fetchAdapterUsage?.(adapterId);
  },

  onUsageData: (callback: (e: CustomEvent<{ adapterId: string; json: string }>) => void) => {
    window.addEventListener(EVENT_NAMES.USAGE_DATA, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.USAGE_DATA, callback as EventListener);
  },

  onLog: (callback: (e: CustomEvent) => void) => {
    window.addEventListener(EVENT_NAMES.LOG, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.LOG, callback as EventListener);
  },

  requestHistoryList: (projectPath?: string) => {
    window.__requestHistoryList?.(projectPath);
  },

  syncHistoryList: (projectPath?: string) => {
    window.__syncHistoryList?.(projectPath);
  },

  onHistoryList: (callback: (e: CustomEvent<HistoryListEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.HISTORY_LIST, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.HISTORY_LIST, callback as EventListener);
  },

  onHistoryDeleteResult: (callback: (e: CustomEvent<HistoryDeleteResultEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.HISTORY_DELETE_RESULT, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.HISTORY_DELETE_RESULT, callback as EventListener);
  },

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
      const cleanup = ACPBridge.onConversationTranscriptSaved((e) => {
        const payload = e.detail.payload;
        if (payload.requestId !== requestId) return;
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

  onUndoResult: (callback: (e: CustomEvent<UndoResultEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.UNDO_RESULT, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.UNDO_RESULT, callback as EventListener);
  },

  onChangesState: (callback: (e: CustomEvent<ChangesStateEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.CHANGES_STATE, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.CHANGES_STATE, callback as EventListener);
  },

  computeFileChangeStats: (files: { filePath: string; status: 'A' | 'M'; operations: FileChangeOperation[] }[]): Promise<FileChangeStatsResultPayload> => {
    return new Promise((resolve, reject) => {
      if (typeof window.__computeFileChangeStats !== 'function') {
        reject(new Error('File change stats bridge is not available.'));
        return;
      }

      const requestId = nextFileChangeStatsRequestId();
      const cleanup = ACPBridge.onFileChangeStats((e) => {
        const payload = e.detail.payload;
        if (payload.requestId !== requestId) return;
        cleanup();
        resolve(payload);
      });

      try {
        window.__computeFileChangeStats(JSON.stringify({ requestId, files }));
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  },

  onToolCall: (callback: (e: CustomEvent<ToolCallBridgeEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.TOOL_CALL, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.TOOL_CALL, callback as EventListener);
  },

  onToolCallUpdate: (callback: (e: CustomEvent<ToolCallBridgeEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.TOOL_CALL_UPDATE, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.TOOL_CALL_UPDATE, callback as EventListener);
  },

  onFileChangeStats: (callback: (e: CustomEvent<FileChangeStatsEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.FILE_CHANGE_STATS, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.FILE_CHANGE_STATS, callback as EventListener);
  },

  onAttachmentsAdded: (callback: (e: CustomEvent<{ chatId: string; files: ChatAttachment[] }>) => void) => {
    window.addEventListener(EVENT_NAMES.ATTACHMENTS_ADDED, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.ATTACHMENTS_ADDED, callback as EventListener);
  },

  onConversationTranscriptSaved: (callback: (e: CustomEvent<ConversationTranscriptSavedEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.CONVERSATION_TRANSCRIPT_SAVED, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.CONVERSATION_TRANSCRIPT_SAVED, callback as EventListener);
  },

  onConversationReplayLoaded: (callback: (e: CustomEvent<ConversationReplayLoadedEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.CONVERSATION_REPLAY_LOADED, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.CONVERSATION_REPLAY_LOADED, callback as EventListener);
  },

  searchFiles: (query: string) => {
    window.__searchFiles?.(query);
  },

  onFilesResult: (callback: (e: CustomEvent<{ files: { path: string, name: string }[] }>) => void) => {
    const fn = (e: Event) => callback(e as CustomEvent);
    window.addEventListener('acp-files-result', fn);
    return () => window.removeEventListener('acp-files-result', fn);
  },

  loadMcpServers: () => {
    window.__loadMcpServers?.();
  },

  saveMcpServers: (servers: McpServerConfig[]) => {
    window.__saveMcpServers?.(JSON.stringify(servers));
  },

  onMcpServers: (callback: (e: CustomEvent<McpServersEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.MCP_SERVERS, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.MCP_SERVERS, callback as EventListener);
  },

  loadPromptLibrary: () => {
    window.__loadPromptLibrary?.();
  },

  savePromptLibrary: (items: PromptLibraryItem[]) => {
    window.__savePromptLibrary?.(JSON.stringify(items));
  },

  onPromptLibrary: (callback: (e: CustomEvent<PromptLibraryEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.PROMPT_LIBRARY, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.PROMPT_LIBRARY, callback as EventListener);
  },

  loadSystemInstructions: () => {
    window.__loadSystemInstructions?.();
  },

  saveSystemInstructions: (instructions: SystemInstruction[]) => {
    window.__saveSystemInstructions?.(JSON.stringify(instructions));
  },

  onSystemInstructions: (callback: (e: CustomEvent<SystemInstructionsEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.SYSTEM_INSTRUCTIONS, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.SYSTEM_INSTRUCTIONS, callback as EventListener);
  },

  loadAudioTranscriptionFeature: () => {
    window.__loadAudioTranscriptionFeature?.();
  },

  installAudioTranscriptionFeature: () => {
    window.__installAudioTranscriptionFeature?.();
  },

  uninstallAudioTranscriptionFeature: () => {
    window.__uninstallAudioTranscriptionFeature?.();
  },

  onAudioTranscriptionFeature: (callback: (e: CustomEvent<AudioTranscriptionFeatureEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.AUDIO_TRANSCRIPTION_FEATURE, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.AUDIO_TRANSCRIPTION_FEATURE, callback as EventListener);
  },

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

  onAudioTranscriptionResult: (callback: (e: CustomEvent<AudioTranscriptionResultEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.AUDIO_TRANSCRIPTION_RESULT, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.AUDIO_TRANSCRIPTION_RESULT, callback as EventListener);
  },

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

  onAudioRecordingState: (callback: (e: CustomEvent<AudioRecordingStateEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.AUDIO_RECORDING_STATE, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.AUDIO_RECORDING_STATE, callback as EventListener);
  },

  loadAudioTranscriptionSettings: () => {
    window.__loadAudioTranscriptionSettings?.();
  },

  saveAudioTranscriptionSettings: (settings: AudioTranscriptionSettings) => {
    window.__saveAudioTranscriptionSettings?.(JSON.stringify(settings));
  },

  onAudioTranscriptionSettings: (callback: (e: CustomEvent<AudioTranscriptionSettingsEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.AUDIO_TRANSCRIPTION_SETTINGS, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.AUDIO_TRANSCRIPTION_SETTINGS, callback as EventListener);
  },

  loadGlobalSettings: () => {
    window.__loadGlobalSettings?.();
  },

  saveGlobalSettings: (settings: GlobalSettingsPayload['settings']) => {
    window.__saveGlobalSettings?.(JSON.stringify(settings));
  },

  onGlobalSettings: (callback: (e: CustomEvent<GlobalSettingsEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.GLOBAL_SETTINGS, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.GLOBAL_SETTINGS, callback as EventListener);
  },

  onExecutionTargetSwitched: (callback: (e: CustomEvent<ExecutionTargetSwitchedEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.EXECUTION_TARGET_SWITCHED, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.EXECUTION_TARGET_SWITCHED, callback as EventListener);
  },
};
