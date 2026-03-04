import { AgentOption, PermissionRequest, HistorySessionMeta, UndoResultPayload, ChangesState, ContentChunk, ToolCallEvent } from '../types/chat';

export interface ContentChunkEvent { chunk: ContentChunk; }
export interface StatusEvent { chatId: string; status: string; }
export interface SessionIdEvent { chatId: string; sessionId: string; }
export interface ModeEvent { chatId: string; modeId: string; }
export interface AdaptersEvent { adapters: AgentOption[]; }
export interface PermissionRequestEvent { request: PermissionRequest; }
export interface HistoryListEvent { list: HistorySessionMeta[]; }
export interface UndoResultEvent { chatId: string; result: UndoResultPayload; }
export interface ChangesStateEvent { chatId: string; state: ChangesState; }
export interface ToolCallBridgeEvent { chatId: string; payload: ToolCallEvent; }


const EVENT_NAMES = {
  CONTENT_CHUNK: 'acp-content-chunk',
  STATUS: 'acp-status',
  SESSION_ID: 'acp-session-id',
  MODE: 'acp-mode',
  ADAPTERS: 'acp-adapters',
  PERMISSION: 'acp-permission',
  LOG: 'acp-log',
  HISTORY_LIST: 'history-list',
  UNDO_RESULT: 'acp-undo-result',
  CHANGES_STATE: 'acp-changes-state',
  ATTACHMENTS_ADDED: 'acp-attachments-added',
  TOOL_CALL: 'acp-tool-call',
  TOOL_CALL_UPDATE: 'acp-tool-call-update'
};

export const ACPBridge = {
  initialize: () => {
    if (typeof window === 'undefined') return;

    window.__onContentChunk = (chunk) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.CONTENT_CHUNK, { detail: { chunk } }));

      // Also dispatch tool_call / tool_call_update events for useFileChanges
      if (chunk.type === 'tool_call' || chunk.type === 'tool_call_update') {
        try {
          const raw = chunk.toolRawJson ? JSON.parse(chunk.toolRawJson) : {};
          // diffs come from ToolCallContent.Diff entries serialized as { type: 'diff', path, oldText, newText }
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
              diffs,
              locations: raw.locations,
            };
            const eventName = chunk.type === 'tool_call' ? EVENT_NAMES.TOOL_CALL : EVENT_NAMES.TOOL_CALL_UPDATE;
            window.dispatchEvent(new CustomEvent(eventName, { detail: { chatId: chunk.chatId, payload } }));
          } else if (chunk.type === 'tool_call_update' && (chunk.toolCallId || raw.toolCallId) && (chunk.toolStatus || raw.status)) {
            // Status-only update (no diffs) — e.g. denied permission or error
            const payload: ToolCallEvent = {
              toolCallId: chunk.toolCallId || raw.toolCallId || '',
              title: chunk.toolTitle || raw.title || '',
              kind: chunk.toolKind || raw.kind,
              status: chunk.toolStatus || raw.status,
              diffs: [],
            };
            window.dispatchEvent(new CustomEvent(EVENT_NAMES.TOOL_CALL_UPDATE, { detail: { chatId: chunk.chatId, payload } }));
          }
        } catch (_) { /* ignore parse errors */ }
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

    window.__onPermissionRequest = (request) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.PERMISSION, { detail: { request } }));
    };
    
    window.__onAcpLog = (payload) => {
      console.log('[ACP]', payload.direction, JSON.parse(payload.json));
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.LOG, { detail: payload }));
    };

    window.__onHistoryList = (list) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.HISTORY_LIST, { detail: { list } }));
    };


    window.__onUndoResult = (chatId, result) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.UNDO_RESULT, { detail: { chatId, result } }));
    };

    window.__onChangesState = (chatId, state) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.CHANGES_STATE, { detail: { chatId, state } }));
    };

    window.__onAttachmentsAdded = (chatId, files) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.ATTACHMENTS_ADDED, { detail: { chatId, files } }));
    };



    // Notify ready
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

  onPermissionRequest: (callback: (e: CustomEvent<PermissionRequestEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.PERMISSION, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.PERMISSION, callback as EventListener);
  },
  
  onLog: (callback: (e: CustomEvent) => void) => {
      window.addEventListener(EVENT_NAMES.LOG, callback as EventListener);
      return () => window.removeEventListener(EVENT_NAMES.LOG, callback as EventListener);
  },

  requestHistoryList: (projectPath?: string) => {
    window.__requestHistoryList?.(projectPath);
  },

  onHistoryList: (callback: (e: CustomEvent<HistoryListEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.HISTORY_LIST, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.HISTORY_LIST, callback as EventListener);
  },
  
  loadHistorySession: (chatId: string, adapterId: string, sessionId: string, modelId?: string, modeId?: string) => {
    window.__loadHistorySession?.(chatId, adapterId, sessionId, modelId, modeId);
  },
  
  deleteHistorySession: (meta: HistorySessionMeta) => {
    window.__deleteHistorySession?.(meta);
  },


  onUndoResult: (callback: (e: CustomEvent<UndoResultEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.UNDO_RESULT, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.UNDO_RESULT, callback as EventListener);
  },

  onChangesState: (callback: (e: CustomEvent<ChangesStateEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.CHANGES_STATE, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.CHANGES_STATE, callback as EventListener);
  },

  onToolCall: (callback: (e: CustomEvent<ToolCallBridgeEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.TOOL_CALL, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.TOOL_CALL, callback as EventListener);
  },

  onToolCallUpdate: (callback: (e: CustomEvent<ToolCallBridgeEvent>) => void) => {
    window.addEventListener(EVENT_NAMES.TOOL_CALL_UPDATE, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.TOOL_CALL_UPDATE, callback as EventListener);
  },

  onAttachmentsAdded: (callback: (e: CustomEvent<{ chatId: string; files: any[] }>) => void) => {
    window.addEventListener(EVENT_NAMES.ATTACHMENTS_ADDED, callback as EventListener);
    return () => window.removeEventListener(EVENT_NAMES.ATTACHMENTS_ADDED, callback as EventListener);
  }
};
