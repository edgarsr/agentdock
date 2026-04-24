import {
  AgentOption,
  AudioRecordingStatePayload,
  AudioTranscriptionFeatureState,
  AudioTranscriptionResultPayload,
  AudioTranscriptionSettings,
  AvailableCommand,
  ChangesState,
  ContentChunk,
  BridgeOperationResultPayload,
  ConversationReplayLoadedPayload,
  ConversationTranscriptSavedPayload,
  FileChangeStatsResultPayload,
  GlobalSettingsPayload,
  HistoryDeleteResultPayload,
  HistorySessionMeta,
  PermissionRequest,
  ToolCallEvent,
  UndoResultPayload,
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
export interface BridgeOperationResultEvent { payload: BridgeOperationResultPayload; }
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
export interface AdapterDeletedEvent { adapterId: string; }

export const EVENT_NAMES = {
  ADAPTER_DELETED: 'acp-adapter-deleted',
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
  BRIDGE_OPERATION_RESULT: 'acp-bridge-operation-result',
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
} as const;

export function onBridgeEvent<T>(eventName: string, callback: (e: CustomEvent<T>) => void) {
  window.addEventListener(eventName, callback as EventListener);
  return () => window.removeEventListener(eventName, callback as EventListener);
}
