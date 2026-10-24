import {
  AgentOption,
  AudioRecordingStatePayload,
  AudioTranscriptionFeatureState,
  AudioTranscriptionResultPayload,
  AvailableCommand,
  ChangesState,
  ChatAttachedPayload,
  ContentChunk,
  BridgeOperationResultPayload,
  ConversationReplayLoadedPayload,
  ConversationTranscriptSavedPayload,
  FileChangeStatsResultPayload,
  FileSearchResultPayload,
  GlobalSettingsPayload,
  HistoryDeleteResultPayload,
  HistorySearchResultPayload,
  HistorySessionMeta,
  PermissionRequest,
  SessionConfigOptionsPayload,
  SpeechResultPayload,
  ToolCallEvent,
  UndoResultPayload,
} from '../types/chat';
import { McpServerConfig, McpStatusUpdate } from '../types/mcp';
import { PromptLibraryItem } from '../types/promptLibrary';
import { SystemInstruction } from '../types/systemInstructions';
import { CustomAcpConfig, CustomAcpStatusUpdate } from '../types/customAcp';
export interface ContentChunkEvent { chunk: ContentChunk; }
export interface StatusEvent { chatId: string; status: string; }
export interface AssistantActivityEvent { chatId: string; }
export interface SessionIdEvent { chatId: string; sessionId: string; }
export interface ModeEvent { chatId: string; modeId: string; }
export interface SessionConfigOptionsEvent { payload: SessionConfigOptionsPayload; }
export interface AdaptersEvent { adapters: AgentOption[]; }
export interface PermissionRequestEvent { request: PermissionRequest; }
export interface AvailableCommandsEvent { adapterId: string; commands: AvailableCommand[]; }
export interface HistoryListEvent { list: HistorySessionMeta[]; }
export interface HistoryDeleteResultEvent { result: HistoryDeleteResultPayload; }
export interface HistorySearchResultEvent { result: HistorySearchResultPayload; }
export interface UndoResultEvent { chatId: string; result: UndoResultPayload; }
export interface ChangesStateEvent { chatId: string; state: ChangesState; }
export interface ToolCallBridgeEvent { chatId: string; payload: ToolCallEvent; }
export interface ConversationTranscriptSavedEvent { payload: ConversationTranscriptSavedPayload; }
export interface BridgeOperationResultEvent { payload: BridgeOperationResultPayload; }
export interface ConversationReplayLoadedEvent { payload: ConversationReplayLoadedPayload; }
export interface ChatAttachedEvent { payload: ChatAttachedPayload; }
export interface FileChangeStatsEvent { payload: FileChangeStatsResultPayload; }
export interface FilesResultEvent { payload: FileSearchResultPayload; }
export interface McpServersEvent { servers: McpServerConfig[]; }
export interface McpStatusEvent { update: McpStatusUpdate; }
export interface CustomAcpConfigsEvent { configs: CustomAcpConfig[]; }
export interface CustomAcpStatusEvent { update: CustomAcpStatusUpdate; }
export interface PromptLibraryEvent { items: PromptLibraryItem[]; }
export interface SystemInstructionsEvent { instructions: SystemInstruction[]; }
export interface AudioTranscriptionFeatureEvent { state: AudioTranscriptionFeatureState; }
export interface AudioTranscriptionResultEvent { payload: AudioTranscriptionResultPayload; }
export interface AudioRecordingStateEvent { payload: AudioRecordingStatePayload; }
export interface SpeechResultEvent { payload: SpeechResultPayload; }
export interface GlobalSettingsEvent { payload: GlobalSettingsPayload; }
export interface AdapterDeletedEvent { adapterId: string; }

export const EVENT_NAMES = {
  ADAPTER_DELETED: 'acp-adapter-deleted',
  CONTENT_CHUNK: 'acp-content-chunk',
  ASSISTANT_ACTIVITY: 'acp-assistant-activity',
  MCP_SERVERS: 'mcp-servers',
  MCP_STATUS: 'mcp-status',
  CUSTOM_ACP_CONFIGS: 'custom-acp-configs',
  CUSTOM_ACP_STATUS: 'custom-acp-status',
  PROMPT_LIBRARY: 'prompt-library',
  SYSTEM_INSTRUCTIONS: 'system-instructions',
  STATUS: 'acp-status',
  SESSION_ID: 'acp-session-id',
  MODE: 'acp-mode',
  SESSION_CONFIG_OPTIONS: 'acp-session-config-options',
  ADAPTERS: 'acp-adapters',
  AVAILABLE_COMMANDS: 'acp-available-commands',
  USAGE_DATA: 'acp-usage-data',
  PERMISSION: 'acp-permission',
  HISTORY_LIST: 'history-list',
  HISTORY_DELETE_RESULT: 'history-delete-result',
  HISTORY_DELETE_REQUEST: 'history-delete-request',
  HISTORY_SEARCH_RESULT: 'history-search-result',
  UNDO_RESULT: 'acp-undo-result',
  CHANGES_STATE: 'acp-changes-state',
  BRIDGE_OPERATION_RESULT: 'acp-bridge-operation-result',
  FILE_CHANGE_STATS: 'acp-file-change-stats',
  FILES_RESULT: 'acp-files-result',
  ATTACHMENTS_ADDED: 'acp-attachments-added',
  TOOL_CALL: 'acp-tool-call',
  TOOL_CALL_UPDATE: 'acp-tool-call-update',
  CONVERSATION_TRANSCRIPT_SAVED: 'conversation-transcript-saved',
  CONVERSATION_REPLAY_LOADED: 'conversation-replay-loaded',
  CHAT_ATTACHED: 'chat-attached',
  AUDIO_TRANSCRIPTION_FEATURE: 'audio-transcription-feature',
  AUDIO_TRANSCRIPTION_RESULT: 'audio-transcription-result',
  AUDIO_RECORDING_STATE: 'audio-recording-state',
  SPEECH_RESULT: 'speech-result',
  GLOBAL_SETTINGS: 'global-settings',
} as const;

export function onBridgeEvent<T>(eventName: string, callback: (e: CustomEvent<T>) => void) {
  window.addEventListener(eventName, callback as EventListener);
  return () => window.removeEventListener(eventName, callback as EventListener);
}
