export interface ToolCallDiffEntry {
  type: 'diff';
  path: string;
  oldText: string | null;
  newText: string;
}

export interface AcpLogEntryPayload {
  direction: 'SENT' | 'RECEIVED';
  category: 'PROTOCOL' | 'INTERNAL' | 'STDERR';
  json: string;
  timestamp: number;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  data?: string;
  path?: string;
  isInline?: boolean;
  attachmentType?: 'file' | 'code_ref';
  startLine?: number;
  endLine?: number;
}

export interface TextBlock { type: 'text'; text: string; }
export interface ImageBlock { type: 'image'; data: string; mimeType: string; isInline?: boolean; }
export interface AudioBlock { type: 'audio'; data: string; mimeType: string; isInline?: boolean; }
export interface VideoBlock { type: 'video'; data: string; mimeType: string; isInline?: boolean; }
export interface FileBlock { type: 'file'; name: string; mimeType: string; data?: string; path?: string; isInline?: boolean; }
export interface CodeReferenceBlock {
  type: 'code_ref';
  id?: string;
  name: string;
  path: string;
  startLine?: number;
  endLine?: number;
  isInline?: boolean;
}

export interface ToolCallEntry {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  result?: string;
  rawJson: string;
  content?: ToolCallDiffEntry[];
  locations?: { path: string }[];
  // For thinking entries
  text?: string;
}
export interface ExploringBlock { type: 'exploring'; isStreaming: boolean; isReplay?: boolean; entries: ToolCallEntry[]; }
export interface ToolCallBlock { type: 'tool_call'; entry: ToolCallEntry; isReplay?: boolean; }
export interface PlanEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
  priority?: string;
}

export interface PlanBlock { type: 'plan'; entries: PlanEntry[]; isReplay?: boolean; }

export type RichContentBlock = TextBlock | ImageBlock | AudioBlock | VideoBlock | FileBlock | CodeReferenceBlock | ExploringBlock | ToolCallBlock | PlanBlock;



export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contentBlocks?: RichContentBlock[];
  blocks?: RichContentBlock[];
  timestamp?: number;
  // Meta-information
  agentId?: string;
  agentName?: string;
  modelName?: string;
  modeName?: string;
  promptStartedAtMillis?: number;
  duration?: number;
  contextTokensUsed?: number;
  contextWindowSize?: number;
  metaComplete?: boolean;
}

export interface ModelOption {
  modelId: string;
  name: string;
  description?: string;
}

export interface ModeOption {
  id: string;
  name: string;
  description?: string;
}

export interface AvailableCommand {
  name: string;
  description: string;
  inputHint?: string | null;
}

export interface AgentOption {
  id: string;
  name: string;
  iconPath?: string;
  isLastUsed?: boolean;
  currentModelId?: string;
  availableModels?: ModelOption[];
  currentModeId?: string;
  availableModes?: ModeOption[];
  downloaded?: boolean;
  downloadedKnown?: boolean;
  downloadPath?: string;
  downloading?: boolean;
  downloadStatus?: string;
  disabledModels?: string[];
  hasAuthentication?: boolean;
  authAuthenticated?: boolean;
  authKnown?: boolean;
  authLoading?: boolean;
  authError?: string;
  authenticating?: boolean;
  authUiMode?: 'login_logout' | 'manage_terminal';
  initializing?: boolean;
  initializationError?: string;
  ready?: boolean;
  readyKnown?: boolean;
  installedVersion?: string;
  latestVersion?: string;
  updateSupported?: boolean;
  updateChecking?: boolean;
  updateKnown?: boolean;
  updateAvailable?: boolean;
  cliAvailable?: boolean;
  executionTarget?: 'windows' | 'wsl';
}

export function isAgentRunnable(agent: AgentOption): boolean {
  return agent.downloaded === true;
}

export interface PermissionRequest {
  requestId: string;
  chatId?: string;
  title: string;
  options: { optionId: string; label: string }[];
}

export interface DropdownOption {
  id: string;
  label: string;
  description?: string;
  iconPath?: string;
  subOptions?: DropdownOption[];
}

export interface TabUiFlags {
  unread: boolean;
  atBottom: boolean;
  warning: boolean;
}

export type TabType = 'chat' | 'management' | 'design' | 'history' | 'mcp' | 'system-instructions' | 'prompt-library' | 'settings';

export interface ChatTab {
  id: string;
  type: TabType;
  title: string;
  conversationId: string;
  agentId?: string; // If pre-selected
  historySession?: HistorySessionMeta;
}

export interface HistoryDeleteFailure {
  conversationId: string;
  message: string;
}

export interface HistoryDeleteResultPayload {
  success: boolean;
  requestedConversationIds: string[];
  failures: HistoryDeleteFailure[];
}

export interface HistorySessionMeta {
  sessionId: string;
  adapterName: string;
  conversationId: string;
  sessionCount?: number;
  promptCount?: number;
  allAdapterNames?: string[];
  modelId?: string;
  modeId?: string;
  projectPath: string;
  title: string;
  filePath: string;
  createdAt: number;
  updatedAt: number;
}

export interface ContentChunk {
  chatId: string;
  role: 'user' | 'assistant';
  type: 'text' | 'thinking' | 'image' | 'audio' | 'video' | 'file' | 'tool_call' | 'tool_call_update' | 'plan' | 'prompt_done';
  text?: string;
  data?: string;
  path?: string;
  name?: string;
  mimeType?: string;
  isReplay: boolean;
  replaySeq?: number;
  // tool_call specific
  toolCallId?: string;
  toolKind?: string;
  toolTitle?: string;
  toolStatus?: string;
  toolRawJson?: string;
  planEntries?: PlanEntry[];
  agentId?: string;
  agentName?: string;
  modelId?: string;
  modelName?: string;
  modeId?: string;
  modeName?: string;
  promptStartedAtMillis?: number;
  durationSeconds?: number;
  contextTokensUsed?: number;
  contextWindowSize?: number;
}

export interface ReplayContentBlock {
  role?: 'user' | 'assistant';
  type?: string;
  text?: string;
  data?: string;
  path?: string;
  name?: string;
  mimeType?: string;
  startLine?: number;
  endLine?: number;
  toolCallId?: string;
  toolKind?: string;
  toolTitle?: string;
  toolStatus?: string;
  toolRawJson?: string;
  planEntries?: PlanEntry[];
}

export interface ConversationAssistantMetadata {
  agentId?: string;
  agentName?: string;
  modelId?: string;
  modelName?: string;
  modeId?: string;
  modeName?: string;
  promptStartedAtMillis?: number;
  durationSeconds?: number;
  contextTokensUsed?: number;
  contextWindowSize?: number;
  promptOutcome?: 'success' | 'error' | 'cancelled';
}

export interface ReplayPromptEntry {
  blocks?: ReplayContentBlock[];
  events?: ReplayContentBlock[];
  assistantMeta?: ConversationAssistantMetadata;
}

export interface ReplaySessionEntry {
  sessionId: string;
  adapterName: string;
  prompts?: ReplayPromptEntry[];
}

export interface ConversationReplayData {
  sessions?: ReplaySessionEntry[];
}

export interface ConversationReplayLoadedPayload {
  chatId: string;
  data: ConversationReplayData;
}


export interface ToolCallDiff {
  path: string;
  oldText: string | null;
  newText: string;
}

export interface ToolCallEvent {
  toolCallId: string;
  title: string;
  kind?: string;
  status?: string;
  isReplay?: boolean;
  diffs: ToolCallDiff[];
  locations?: { path: string; line?: number }[];
}

export interface FileChangeOperation {
  oldText: string;
  newText: string;
}

export interface FileChangeSummary {
  filePath: string;
  fileName: string;
  status: 'A' | 'M';
  additions: number;
  deletions: number;
  operations: FileChangeOperation[];
  latestToolCallIndex: number;
}

export interface FileChangeStatsPayload {
  filePath: string;
  additions: number;
  deletions: number;
}

export interface FileChangeStatsResultPayload {
  requestId: string;
  files: FileChangeStatsPayload[];
}

export interface ProcessedFileState {
  filePath: string;
  toolCallIndex: number;
}

export interface ChangesState {
  sessionId: string;
  adapterName: string;
  baseToolCallIndex: number;
  processedFileStates: ProcessedFileState[];
  hasPluginEdits?: boolean;
}

export interface UndoFileResultPayload {
  filePath: string;
  success: boolean;
  message: string;
}

export interface UndoResultPayload {
  success: boolean;
  message: string;
  fileResults: UndoFileResultPayload[];
}

export interface SessionMetadataUpdatePayload {
  conversationId: string;
  sessionId: string;
  adapterName: string;
  promptCount: number;
  title?: string;
  touchUpdatedAt?: boolean;
}

export interface ContinueConversationPayload {
  previousSessionId: string;
  previousAdapterName: string;
  sessionId: string;
  adapterName: string;
  title?: string;
}

export interface PendingHandoffContext {
  id: string;
  sourceSessionId: string;
  sourceAgentId: string;
  targetAgentId: string;
  text: string;
}

export interface ConversationTranscriptSavedPayload {
  requestId: string;
  conversationId: string;
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface AudioTranscriptionFeatureState {
  id: string;
  title: string;
  installed: boolean;
  installing: boolean;
  supported: boolean;
  status: string;
  detail: string;
  installPath: string;
}

export interface AudioTranscriptionResultPayload {
  requestId: string;
  success: boolean;
  text?: string;
  error?: string;
}

export interface AudioRecordingStatePayload {
  recording: boolean;
  error?: string;
}

export interface AudioTranscriptionSettings {
  language: string;
}

export interface GitCommitGenerationSettings {
  enabled: boolean;
  adapterId: string;
  modelId: string;
  instructions: string;
}

export interface HostSettingsInfo {
  hostOs: 'windows' | 'other';
  wslSupported: boolean;
  wslDistributions: { name: string }[];
  uiFontSizeBasePx: number;
}

export interface GlobalSettings {
  useWslForAcpAdapters: boolean;
  wslDistributionName: string;
  audioNotificationsEnabled: boolean;
  uiFontSizeOffsetPx: number;
  userMessageBackgroundStyle: 'background-secondary' | 'primary' | 'secondary' | 'accent' | 'input' | 'editor-bg';
  audioTranscription: AudioTranscriptionSettings;
  gitCommitGeneration: GitCommitGenerationSettings;
}

export interface GlobalSettingsPayload {
  settings: GlobalSettings;
  host: HostSettingsInfo;
}

export interface ExecutionTargetSwitchPayload {
  executionTarget: 'windows' | 'wsl';
}

declare global {
  interface Window {
    // Actions (Frontend -> Backend)
    __startAgent?: (conversationId: string, adapterId?: string, modelId?: string) => void;
    __setModel?: (conversationId: string, adapterId: string, modelId: string) => void;
    __setMode?: (conversationId: string, adapterId: string, modeId: string) => void;
    __sendPrompt?: (conversationId: string, message: string) => void;
    __requestAdapters?: () => void;
    __notifyReady?: () => void;
    __respondPermission?: (requestId: string, decision: string) => void;
    __cancelPrompt?: (conversationId: string) => void;
    __stopAgent?: (conversationId: string) => void;
    __downloadAgent?: (adapterId: string) => void;
    __deleteAgent?: (adapterId: string) => void;
    __updateAgent?: (adapterId: string) => void;
    __requestHistoryList?: (projectPath?: string) => void;
    __syncHistoryList?: (projectPath?: string) => void;
    __deleteHistoryConversations?: (payload: { projectPath: string; conversationIds: string[] }) => void;
    __renameHistoryConversation?: (payload: { projectPath: string; conversationId: string; newTitle: string }) => void;
    __loadHistoryConversation?: (conversationId: string, projectPath: string, historyConversationId: string) => void;
    __loginAgent?: (adapterId: string) => void;
    __logoutAgent?: (adapterId: string) => void;
    __fetchAdapterUsage?: (adapterId: string) => void;
    __openAgentCli?: (adapterId: string) => void;
    __openHistoryConversationCli?: (payload: { projectPath: string; conversationId: string }) => void;
    __undoFile?: (payload: string) => void;
    __undoAllFiles?: (payload: string) => void;
    __processFile?: (payload: string) => void;
    __keepAll?: (payload: string) => void;
    __removeProcessedFiles?: (payload: string) => void;
    __getChangesState?: (payload: string) => void;
    __computeFileChangeStats?: (payload: string) => void;
    __showDiff?: (payload: string) => void;
    __openFile?: (payload: string) => void;
    __openUrl?: (url: string) => void;
    __attachFile?: (conversationId: string) => void;
    __updateSessionMetadata?: (payload: SessionMetadataUpdatePayload) => void;
    __continueConversationWithSession?: (payload: ContinueConversationPayload) => void;
    __saveConversationTranscript?: (payload: string) => void;
    __requestHostRepaint?: (reason?: string) => void;

    // Callbacks (Backend -> Frontend)
    __onAcpLog?: (payload: AcpLogEntryPayload) => void;
    __onContentChunk?: (chunk: ContentChunk) => void;
    __onStatus?: (chatId: string, status: string) => void;
    __onSessionId?: (chatId: string, id: string) => void;
    __onAdapters?: (adapters: AgentOption[]) => void;
    __onAvailableCommands?: (adapterId: string, commands: AvailableCommand[]) => void;
    __onMode?: (chatId: string, modeId: string) => void;
    __onPermissionRequest?: (request: PermissionRequest) => void;
    __onHistoryList?: (list: HistorySessionMeta[]) => void;
    __onHistoryDeleteResult?: (result: HistoryDeleteResultPayload) => void;
    __onConversationReplayLoaded?: (payload: ConversationReplayLoadedPayload) => void;
    __onAttachmentsAdded?: (chatId: string, files: ChatAttachment[]) => void;
    __onConversationTranscriptSaved?: (payload: ConversationTranscriptSavedPayload) => void;
    __onUsageData?: (adapterId: string, json: string) => void;

    __onUndoResult?: (chatId: string, result: UndoResultPayload) => void;
    __onChangesState?: (chatId: string, state: ChangesState) => void;
    __onFileChangeStats?: (payload: FileChangeStatsResultPayload) => void;

    __onMcpServers?: (servers: unknown) => void;
    __onFilesResult?: (filesJson: unknown) => void;
    __searchFiles?: (query: string) => void;
    __loadMcpServers?: () => void;
    __saveMcpServers?: (json: string) => void;
    __onPromptLibrary?: (items: unknown) => void;
    __loadPromptLibrary?: () => void;
    __savePromptLibrary?: (json: string) => void;
    __onSystemInstructions?: (instructions: unknown) => void;
    __loadSystemInstructions?: () => void;
    __saveSystemInstructions?: (json: string) => void;
    __loadAudioTranscriptionFeature?: () => void;
    __installAudioTranscriptionFeature?: () => void;
    __uninstallAudioTranscriptionFeature?: () => void;
    __onAudioTranscriptionFeature?: (state: AudioTranscriptionFeatureState) => void;
    __transcribeAudioInput?: (payload: string) => void;
    __onAudioTranscriptionResult?: (payload: AudioTranscriptionResultPayload) => void;
    __startAudioRecording?: () => void;
    __stopAudioRecording?: (payload: string) => void;
    __onAudioRecordingState?: (payload: AudioRecordingStatePayload) => void;
    __loadAudioTranscriptionSettings?: () => void;
    __saveAudioTranscriptionSettings?: (payload: string) => void;
    __onAudioTranscriptionSettings?: (settings: AudioTranscriptionSettings) => void;
    __loadGlobalSettings?: () => void;
    __saveGlobalSettings?: (payload: string) => void;
    __onGlobalSettings?: (payload: GlobalSettingsPayload) => void;
    __onExecutionTargetSwitched?: (payload: ExecutionTargetSwitchPayload) => void;
    __settingsBridgeReady?: boolean;
  }
}






