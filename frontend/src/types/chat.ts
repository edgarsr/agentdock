export interface AcpLogEntryPayload {
  direction: 'SENT' | 'RECEIVED';
  json: string;
  timestamp: number;
}

export interface TextBlock { type: 'text'; text: string; }
export interface ImageBlock { type: 'image'; data: string; mimeType: string; }

export interface ToolCallEntry {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  result?: string;
  rawJson: string;
  content?: Record<string, string | undefined>[];
  locations?: { path: string }[];
  // For thinking entries
  text?: string;
}
export interface ExploringBlock { type: 'exploring'; isStreaming: boolean; isReplay?: boolean; entries: ToolCallEntry[]; }
export interface ToolCallBlock { type: 'tool_call'; entry: ToolCallEntry; isReplay?: boolean; }

export type RichContentBlock = TextBlock | ImageBlock | ExploringBlock | ToolCallBlock;



export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contentBlocks?: RichContentBlock[];
  blocks?: RichContentBlock[]; // Updated to use RichContentBlock[]
  timestamp: number;
}

export interface ModelOption {
  id: string;
  displayName: string;
}

export interface ModeOption {
  id: string;
  displayName: string;
}

export interface AgentOption {
  id: string;
  displayName: string;
  isDefault: boolean;
  defaultModelId?: string;
  models?: ModelOption[];
  defaultModeId?: string;
  modes?: ModeOption[];
  downloaded: boolean;
  enabled: boolean;
  downloadPath?: string;
  downloading?: boolean;
  downloadStatus?: string;
  supportingTools?: { name: string; path: string }[];
  authAuthenticated?: boolean;
  authPath?: string;
  authenticating?: boolean;
}

export interface PermissionRequest {
  requestId: string;
  chatId?: string;
  description: string;
  options: { optionId: string; label: string }[];
}

export interface DropdownOption {
  id: string;
  label: string;
}

export interface ChatTab {
  id: string;
  title: string;
  sessionId: string; // Creates linkage to backend session
  agentId?: string; // If pre-selected
  historySession?: HistorySessionMeta;
}

export interface HistorySessionMeta {
  sessionId: string;
  adapterName: string;
  modelId?: string;
  modeId?: string;
  projectPath: string;
  title: string;
  filePath: string;
  customVariables?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface ContentChunk {
  chatId: string;
  role: 'user' | 'assistant';
  type: 'text' | 'thinking' | 'image' | 'tool_call' | 'tool_call_update';
  text?: string;
  data?: string;
  mimeType?: string;
  isReplay: boolean;
  // tool_call specific
  toolCallId?: string;
  toolKind?: string;
  toolTitle?: string;
  toolStatus?: string;
  toolRawJson?: string;
}


export interface FileChangeSummary {
  filePath: string;
  fileName: string;
  status: 'A' | 'M';
  additions: number;
  deletions: number;
  operations: { oldText: string; newText: string }[];
}

export interface ChangesState {
  sessionId: string;
  adapterName: string;
  baseToolCallIndex: number;
  processedFiles: string[];
}

export interface UndoResultPayload {
  success: boolean;
  message: string;
}

declare global {
  interface Window {
    // Actions (Frontend -> Backend)
    __startAgent?: (chatId: string, adapterId?: string, modelId?: string) => void;
    __setModel?: (chatId: string, modelId: string) => void;
    __setMode?: (chatId: string, modeId: string) => void;
    __sendPrompt?: (chatId: string, message: string) => void;
    __requestAdapters?: () => void;
    __notifyReady?: () => void;
    __respondPermission?: (requestId: string, decision: string) => void;
    __cancelPrompt?: (chatId: string) => void;
    __stopAgent?: (chatId: string) => void;
    __downloadAgent?: (adapterId: string) => void;
    __deleteAgent?: (adapterId: string) => void;
    __toggleAgentEnabled?: (adapterId: string, enabled: boolean) => void;
    __requestHistoryList?: (projectPath?: string) => void;
    __deleteHistorySession?: (meta: any) => void;
    __loadHistorySession?: (chatId: string, adapterId: string, sessionId: string, modelId?: string, modeId?: string) => void;
    __loginAgent?: (adapterId: string) => void;
    __logoutAgent?: (adapterId: string) => void;
    __undoFile?: (payload: string) => void;
    __undoAllFiles?: (payload: string) => void;
    __processFile?: (payload: string) => void;
    __keepAll?: (payload: string) => void;
    __removeProcessedFiles?: (payload: string) => void;
    __getChangesState?: (payload: string) => void;
    __showDiff?: (payload: string) => void;
    __openFile?: (payload: string) => void;
    __openUrl?: (url: string) => void;

    // Callbacks (Backend -> Frontend)
    __onAcpLog?: (payload: AcpLogEntryPayload) => void;
    __onContentChunk?: (chunk: ContentChunk) => void;
    __onStatus?: (chatId: string, status: string) => void;
    __onSessionId?: (chatId: string, id: string) => void;
    __onAdapters?: (adapters: AgentOption[]) => void;
    __onMode?: (chatId: string, modeId: string) => void;
    __onPermissionRequest?: (request: PermissionRequest) => void;
    __onHistoryList?: (list: HistorySessionMeta[]) => void;

    __onUndoResult?: (chatId: string, result: UndoResultPayload) => void;
    __onChangesState?: (chatId: string, state: ChangesState) => void;
  }
}
