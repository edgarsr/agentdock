
export interface AcpLogEntryPayload {
  direction: 'SENT' | 'RECEIVED';
  json: string;
  timestamp: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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

export interface HistoryReplayChunk {
  chatId: string;
  role: 'user' | 'assistant';
  text: string;
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
    __requestHistoryList?: (projectPath?: string) => void;
    __deleteHistorySession?: (meta: any) => void;
    __loadHistorySession?: (chatId: string, adapterId: string, sessionId: string, modelId?: string, modeId?: string) => void;

    // Callbacks (Backend -> Frontend)
    // Note: These are set by the frontend on window.
    __onAcpLog?: (payload: AcpLogEntryPayload) => void;
    __onAgentText?: (chatId: string, text: string) => void;
    __onStatus?: (chatId: string, status: string) => void;
    __onSessionId?: (chatId: string, id: string) => void;
    __onAdapters?: (adapters: AgentOption[]) => void;
    __onMode?: (chatId: string, modeId: string) => void;
    __onPermissionRequest?: (request: PermissionRequest) => void;
    __onHistoryList?: (list: HistorySessionMeta[]) => void;
    __onHistoryReplay?: (payload: HistoryReplayChunk) => void;
  }
}
