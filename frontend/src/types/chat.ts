import type { ReactNode } from 'react';

export interface ToolCallDiffEntry {
  type: 'diff';
  path: string;
  oldText: string | null;
  newText: string;
}

export interface AcpLogEntryPayload {
  adapterId: string;
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
  attachmentType?: 'file' | 'code_ref' | 'quote';
  startLine?: number;
  endLine?: number;
  quote?: string;
}

export interface TextBlock { type: 'text'; text: string; }
export interface ImageBlock { type: 'image'; data: string; mimeType: string; isInline?: boolean; }
export interface AudioBlock { type: 'audio'; data: string; mimeType: string; isInline?: boolean; }
export interface VideoBlock { type: 'video'; data: string; mimeType: string; name?: string; path?: string; isInline?: boolean; }
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
/** Text the user selected in an assistant response and quoted in the prompt. */
export interface QuoteBlock { type: 'quote'; quote: string; }

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

export type RichContentBlock = TextBlock | ImageBlock | AudioBlock | VideoBlock | FileBlock | CodeReferenceBlock | QuoteBlock | ExploringBlock | ToolCallBlock | PlanBlock;

export interface MessageConfigOption {
  id: string;
  name: string;
  value: string;
  displayValue?: string;
}

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
  configOptions?: MessageConfigOption[];
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

export interface ReasoningEffortOption {
  id: string;
  name: string;
  description?: string;
}

export interface ConfigOptionValue {
  value: string;
  name: string;
  description?: string;
}

export interface ConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: 'select' | 'boolean';
  currentValue?: string;
  options: ConfigOptionValue[];
}

export interface SessionConfigOptionsPayload {
  chatId: string;
  applyCurrentValues: boolean;
  configOptions: ConfigOption[];
  configOptionsByModel: Record<string, ConfigOption[]>;
}

export interface AvailableCommand {
  name: string;
  description: string;
  inputHint?: string | null;
}

export interface AgentAuthMethod {
  id: string;
  name: string;
  description: string;
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
  currentReasoningEffortId?: string;
  availableReasoningEfforts?: ReasoningEffortOption[];
  configOptions?: ConfigOption[];
  configOptionsByModel?: Record<string, ConfigOption[]>;
  modelByMode?: Record<string, string>;
  effortByModel?: Record<string, string>;
  downloaded?: boolean;
  downloadedKnown?: boolean;
  downloadPath?: string;
  downloading?: boolean;
  downloadStatus?: string;
  disabledModels?: string[];
  loginMethod?: string | null;
  authMethods?: AgentAuthMethod[];
  authError?: string;
  authenticating?: boolean;
  authenticatingMethodId?: string;
  loginStatusSupported?: boolean;
  loggedIn?: boolean | null;
  logoutAvailable?: boolean;
  initializing?: boolean;
  initializationDetail?: string;
  initializationError?: string;
  ready?: boolean;
  readyKnown?: boolean;
  installedVersion?: string;
  agentVersion?: string;
  latestVersion?: string;
  updateSupported?: boolean;
  updateChecking?: boolean;
  updateKnown?: boolean;
  updateAvailable?: boolean;
  /** Its status checks (installation, login, versions) are being rerun. */
  refreshing?: boolean;
  cliAvailable?: boolean;
  cliResumeAvailable?: boolean;
  custom?: boolean;
}

export type ConfigLinks = Pick<AgentOption, 'modelByMode' | 'effortByModel'>;

export function isAgentRunnable(agent: AgentOption): boolean {
  return agent.downloaded === true;
}

export interface PermissionRequest {
  requestId: string;
  chatId?: string;
  title: string;
  options: { optionId: string; label: string; kind: string }[];
}

export type ApprovalMode = 'ask' | 'auto';

export interface DropdownOption {
  id: string;
  label: string;
  description?: string;
  className?: string;
  icon?: string | ReactNode;
  iconPath?: string;
  subOptions?: DropdownOption[];
}

export type AttentionLevel = 'warning' | 'unread' | '';

export interface TabUiFlags {
  unread: boolean;
  canMarkRead: boolean;
  warning: boolean;
  processing: boolean;
  queued: boolean;
}

export type SectionType = 'management' | 'design' | 'history' | 'archive' | 'mcp' | 'custom-acp' | 'system-instructions' | 'prompt-library' | SettingsSectionType;
export type SettingsSectionType = 'general' | 'appearance' | 'shortcuts';

export interface ChatTab {
  id: string;
  title: string;
  conversationId: string;
  agentId?: string; // If pre-selected
  historySession?: HistorySessionMeta;
  initialMessages?: Message[];
  inheritedHandoffText?: string;
  metadataTitleOverride?: string;
  /** Title given before the first prompt, written to the history index once the conversation is registered. */
  pendingTitle?: string;
  inheritedAdapterNames?: string[];
  forkBase?: ForkConversationBase;
  /** A pinned conversation listed among the chats without being open. */
  closed?: boolean;
  /** Reopened from the saved workspace: the backend sends the conversation, nothing is loaded again. */
  restored?: boolean;
}

/** The conversation a chat continues, the key of its history entry. */
export const conversationKeyOf = (tab: ChatTab) => tab.historySession?.conversationId || tab.conversationId;

export interface HistoryDeleteFailure {
  conversationId: string;
  message: string;
}

export interface HistoryDeleteResultPayload {
  success: boolean;
  requestedConversationIds: string[];
  failures: HistoryDeleteFailure[];
}

export interface HistorySearchResultPayload {
  query: string;
  /** Keyed by the conversation id; only the conversations with a match. */
  snippets: Record<string, string>;
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
  configOptions?: Record<string, string>;
  projectPath: string;
  title: string;
  filePath: string;
  createdAt: number;
  updatedAt: number;
  deletable?: boolean;
  pinned?: boolean;
  archived?: boolean;
  group?: string;
}

export interface ContentChunk {
  chatId: string;
  role: 'user' | 'assistant';
  type: 'text' | 'thinking' | 'image' | 'audio' | 'video' | 'file' | 'code_ref' | 'quote' | 'tool_call' | 'tool_call_update' | 'plan' | 'prompt_done';
  text?: string;
  quote?: string;
  data?: string;
  path?: string;
  name?: string;
  mimeType?: string;
  isInline?: boolean;
  startLine?: number;
  endLine?: number;
  /** Set only for chunks synthesized from stored conversation data, never for live agent output. */
  isReplay?: boolean;
  // tool_call specific
  toolCallId?: string;
  toolKind?: string;
  toolTitle?: string;
  toolStatus?: string;
  toolRawJson?: string;
  planEntries?: PlanEntry[];
  agentId?: string;
  agentName?: string;
  configOptions?: MessageConfigOption[];
  promptStartedAtMillis?: number;
  durationSeconds?: number;
  contextTokensUsed?: number;
  contextWindowSize?: number;
}

export interface ReplayContentBlock {
  role?: 'user' | 'assistant';
  type?: string;
  text?: string;
  quote?: string;
  data?: string;
  path?: string;
  name?: string;
  mimeType?: string;
  isInline?: boolean;
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
  configOptions?: MessageConfigOption[];
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

/** A chat as the backend knows it, sent to a UI taking it over; its later events follow as usual. */
export interface ChatAttachedPayload {
  chatId: string;
  data?: ConversationReplayData | null;
  /** The prompt the agent is still answering, stored like a finished one. */
  livePrompt?: { sessionId: string; adapterName: string; prompt: ReplayPromptEntry } | null;
  status?: string | null;
  sessionId?: string | null;
  permissions: PermissionRequest[];
}


export interface ToolCallDiff {
  path: string;
  oldText: string | null;
  newText: string;
}

export interface ToolCallEvent {
  eventId?: string;
  toolCallId: string;
  title: string;
  kind?: string;
  status?: string;
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
  status: 'A' | 'M' | 'D';
  additions: number;
  deletions: number;
  operations: FileChangeOperation[];
  toolCallIds: string[];
}

export interface FileChangeStatsPayload {
  filePath: string;
  status: 'A' | 'M' | 'D';
  additions: number;
  deletions: number;
}

export interface FileChangeStatsResultPayload {
  requestId: string;
  files: FileChangeStatsPayload[];
}

export interface FileSearchResultPayload {
  requestId: string;
  files: { path: string; name: string }[];
}

export interface ProcessedFileState {
  filePath: string;
  toolCallIds: string[];
}

export interface ChangesState {
  sessionId: string;
  adapterName: string;
  keptToolCallIds: string[];
  processedFileStates: ProcessedFileState[];
  hasPluginEdits?: boolean;
}

export interface UndoFileResultPayload {
  filePath: string;
  success: boolean;
  message: string;
  reason?: 'conflict';
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
  inheritedAdapterNames?: string[];
  touchUpdatedAt?: boolean;
  forceTitle?: boolean;
}

export interface ForkConversationBase {
  sourceConversationId: string;
  promptCount: number;
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
  sourceConversationTitle: string;
  text: string;
}

export interface ConversationTranscriptSavedPayload {
  requestId: string;
  conversationId: string;
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface BridgeOperationResultPayload {
  requestId: string;
  chatId: string;
  operation: 'start_agent' | 'send_prompt' | 'cancel_prompt';
  ok: boolean;
  error?: string;
}

export interface AudioTranscriptionFeatureState {
  id: string;
  title: string;
  installed: boolean;
  installing: boolean;
  supported: boolean;
  installable: boolean;
  installPath: string;
}

export interface AudioTranscriptionResultPayload {
  requestId: string;
  success: boolean;
  text?: string;
  error?: string;
  cancelled?: boolean;
}

export interface AudioRecordingStatePayload {
  recording: boolean;
  error?: string;
  ownerId?: string;
}

export interface AudioTranscriptionProviderSettings {
  apiKey: string;
}

export interface AudioTranscriptionSettings {
  provider: string;
  language: string;
  providers: Record<string, AudioTranscriptionProviderSettings>;
}

export interface AudioOutputProviderSettings {
  apiKey: string;
  voice: string;
}

export interface AudioOutputSettings {
  provider: string;
  providers: Record<string, AudioOutputProviderSettings>;
}

export interface SpeechResultPayload {
  requestId: string;
  error?: string | null;
}

export interface GitCommitGenerationSettings {
  enabled: boolean;
  adapterId: string;
  modelId: string;
  reasoningEffortId: string;
  instructions: string;
}

export interface ShortcutSettings {
  search: string;
  newChat: string;
  closeChat: string;
  history: string;
  manage: string;
  focusInput: string;
  cancelPrompt: string;
  tabNumbers: boolean;
}

export interface GlobalSettings {
  audioNotificationsEnabled: boolean;
  uiZoomPercent: number;
  contentMaxWidthPx: number;
  userMessageBackgroundStyle: 'default' | 'blue-highlight' | 'blue' | 'background-secondary' | 'accent' | 'custom';
  userMessageCustomColor: string;
  audioTranscription: AudioTranscriptionSettings;
  audioOutput: AudioOutputSettings;
  gitCommitGeneration: GitCommitGenerationSettings;
  systemInstructionsEnabled: boolean;
  quotaWidgetEnabled: boolean;
  openInEditor: boolean;
  browserAccessEnabled: boolean;
  browserAccessPort: number;
  // At least 4 characters; null until the backend generates one.
  browserAccessCode: string | null;
  promptNavigationHoverOnly: boolean;
  userMessageDetailsHoverOnly: boolean;
  sidebarPosition: 'left' | 'right';
  historyGroupsExpanded: boolean;
  rememberModelAndEffort: boolean;
  approvalMode: ApprovalMode;
  sendMode: 'enter' | 'ctrl-enter';
  shortcuts: ShortcutSettings;
}

export interface GlobalSettingsPayload {
  settings: GlobalSettings;
}

declare global {
  interface Window {
    // Actions (Frontend -> Backend)
    __startAgent?: (
      conversationId: string,
      adapterId?: string,
      configValues?: Record<string, string>,
      requestId?: string
    ) => void;
    __sendPrompt?: (
      conversationId: string,
      message: string,
      requestId?: string,
      forkBase?: ForkConversationBase,
      adapterId?: string,
      configValues?: Record<string, string>
    ) => void;
    __requestAdapters?: (adapterIdToRefresh?: string) => void;
    __rememberAgentConfigOptions?: (
      adapterId: string,
      configValues: Record<string, string>,
      links?: ConfigLinks
    ) => void;
    __notifyReady?: () => void;
    __respondPermission?: (requestId: string, decision: string) => void;
    __cancelPrompt?: (conversationId: string, requestId?: string) => void;
    __stopAgent?: (conversationId: string) => void;
    __downloadAgent?: (adapterId: string) => void;
    __cancelAgentInstall?: (adapterId: string) => void;
    __deleteAgent?: (adapterId: string) => void;
    __updateAgent?: (adapterId: string) => void;
    __requestHistoryList?: (projectPath?: string) => void;
    __syncHistoryList?: (projectPath?: string) => void;
    __deleteHistoryConversations?: (payload: { projectPath: string; conversationIds: string[] }) => void;
    __updateHistoryConversations?: (payload: {
      projectPath: string;
      conversationIds: string[];
      newTitle?: string;
      pinned?: boolean;
      archived?: boolean;
      group?: string;
    }) => void;
    __renameHistoryGroup?: (payload: { projectPath: string; group: string; newGroup: string }) => void;
    __searchHistoryConversations?: (payload: { projectPath: string; conversationIds: string[]; query: string }) => void;
    __loadHistoryConversation?: (conversationId: string, projectPath: string, historyConversationId: string) => void;
    __attachChat?: (chatId: string, projectPath: string) => void;
    __loginAgent?: (adapterId: string, methodId: string) => void;
    __logoutAgent?: (adapterId: string) => void;
    __cancelAgentAuth?: (adapterId: string) => void;
    __fetchAdapterUsage?: (adapterId: string, view?: boolean) => void;
    __openAgentCli?: (adapterId: string) => void;
    __openHistoryConversationCli?: (payload: { projectPath: string; conversationId: string }) => void;
    __undoFile?: (payload: string) => void;
    __undoAllFiles?: (payload: string) => void;
    __processFile?: (payload: string) => void;
    __keepAll?: (payload: string) => void;
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
    /** Answered with an `agent-dock-ui-visibility` event telling whether the UI is on screen. */
    __readUiVisibility?: () => void;
    /** Answered with an `agent-dock-ui-zoom` event carrying the current UI zoom. */
    __readUiZoom?: () => void;
    /** Answered with an `agent-dock-browser-address` event carrying the page's web server address, empty while it does not run. */
    __readBrowserAddress?: () => void;
    /** Mirrors the open chats' dot on the plugin icon: `warning`, `unread`, or empty for none. */
    __setAttentionBadge?: (level: AttentionLevel) => void;

    // Callbacks (Backend -> Frontend)
    __onAcpLog?: (payload: AcpLogEntryPayload) => void;
    __onContentChunk?: (chunk: ContentChunk) => void;
    __onStatus?: (chatId: string, status: string) => void;
    __onAssistantActivity?: (chatId: string) => void;
    __onSessionId?: (chatId: string, id: string) => void;
    __onAdapters?: (adapters: AgentOption[]) => void;
    __onAvailableCommands?: (adapterId: string, commands: AvailableCommand[]) => void;
    __onMode?: (chatId: string, modeId: string) => void;
    __onSessionConfigOptions?: (payload: SessionConfigOptionsPayload) => void;
    __onPermissionRequest?: (request: PermissionRequest) => void;
    __onHistoryList?: (list: HistorySessionMeta[]) => void;
    __onHistoryDeleteResult?: (result: HistoryDeleteResultPayload) => void;
    __onHistorySearchResult?: (result: HistorySearchResultPayload) => void;
    __onConversationReplayLoaded?: (payload: ConversationReplayLoadedPayload) => void;
    __onChatAttached?: (payload: ChatAttachedPayload) => void;
    __onAttachmentsAdded?: (chatId: string, files: ChatAttachment[]) => void;
    __onConversationTranscriptSaved?: (payload: ConversationTranscriptSavedPayload) => void;
    __onBridgeOperationResult?: (payload: BridgeOperationResultPayload) => void;
    __onUsageData?: (adapterId: string, json: string) => void;

    __onUndoResult?: (chatId: string, result: UndoResultPayload) => void;
    __onChangesState?: (chatId: string, state: ChangesState) => void;
    __onFileChangeStats?: (payload: FileChangeStatsResultPayload) => void;

    __onMcpServers?: (servers: unknown) => void;
    __onMcpStatus?: (update: unknown) => void;
    __onCustomAcpConfigs?: (configs: unknown) => void;
    __onCustomAcpStatus?: (update: import('./customAcp').CustomAcpStatusUpdate) => void;
    __onFilesResult?: (payload: FileSearchResultPayload) => void;
    __searchFiles?: (payload: string) => void;
    __requestFileIcon?: (path: string) => void;
    __onFileIconResult?: (result: { path: string; icon: string }) => void;
    __readLocalImage?: (path: string) => void;
    __onLocalImageResult?: (result: { path: string; dataUrl: string }) => void;
    __onThemeChanged?: () => void;
    __loadMcpServers?: () => void;
    __saveMcpServers?: (json: string) => void;
    __checkMcpStatus?: (id: string) => void;
    __cancelMcpStatus?: (id: string) => void;
    __loadCustomAcpConfigs?: () => void;
    __saveCustomAcpConfigs?: (json: string) => void;
    __testCustomAcpConnection?: (json: string) => void;
    __cancelCustomAcpConnectionTest?: (id: string) => void;
    __onPromptLibrary?: (items: unknown) => void;
    __loadPromptLibrary?: () => void;
    __savePromptLibrary?: (json: string) => void;
    __onSystemInstructions?: (instructions: unknown) => void;
    __loadSystemInstructions?: () => void;
    __saveSystemInstructions?: (json: string) => void;
    __loadAudioTranscriptionFeature?: (payload?: string) => void;
    __installAudioTranscriptionFeature?: (payload?: string) => void;
    __cancelAudioTranscriptionFeatureInstall?: (payload?: string) => void;
    __uninstallAudioTranscriptionFeature?: (payload?: string) => void;
    __onAudioTranscriptionFeature?: (state: AudioTranscriptionFeatureState) => void;
    __onAudioTranscriptionResult?: (payload: AudioTranscriptionResultPayload) => void;
    __startAudioRecording?: (ownerId: string) => void;
    __stopAudioRecording?: (payload: string) => void;
    __cancelAudioTranscription?: (payload: string) => void;
    __cancelAudioRecording?: (ownerId: string) => void;
    __onAudioRecordingState?: (payload: AudioRecordingStatePayload) => void;
    __startSpeech?: (payload: string) => void;
    __stopSpeech?: (requestId: string) => void;
    __onSpeechResult?: (payload: SpeechResultPayload) => void;
    __loadGlobalSettings?: () => void;
    __saveGlobalSettings?: (payload: string) => void;
    __onGlobalSettings?: (payload: GlobalSettingsPayload) => void;
    // Answered by the client itself, which keeps the workspace while the page is reloaded.
    __loadUiWorkspace?: () => void;
    __saveUiWorkspace?: (json: string) => void;
    __onUiWorkspace?: (json: string) => void;
    __onAdapterDeleted?: (adapterId: string) => void;
    __settingsBridgeReady?: boolean;
    // The kind of page showing the UI, set by BridgeScripts.kt.
    __AGENT_DOCK_CLIENT?: 'jcef' | 'browser';
    // Set with an `agent-dock-elsewhere` event when another page shows the UI.
    __agentDockElsewhere?: boolean;
    // Set with an `agent-dock-disconnected` event when a browser page loses the IDE.
    __agentDockDisconnected?: boolean;
    // Defined by JcefUi.kt and, in a web browser, by BridgeScripts.browserBridge.
    __takeOverUi?: () => void;
    // Loads the page again, which restores the UI. Defined like `__takeOverUi`.
    __reloadUi?: () => void;
    // JCEF only.
    __openInBrowser?: () => void;
    // Injected into the HTML by AssetLoader.kt.
    __pluginVersion?: string;
  }
}
