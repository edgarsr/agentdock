import { AgentOption, PermissionRequest, HistorySessionMeta, UndoResultPayload, ChangesState, ContentChunk } from '../types/chat';

export interface ContentChunkEvent { chunk: ContentChunk; }
export interface StatusEvent { chatId: string; status: string; }
export interface SessionIdEvent { chatId: string; sessionId: string; }
export interface ModeEvent { chatId: string; modeId: string; }
export interface AdaptersEvent { adapters: AgentOption[]; }
export interface PermissionRequestEvent { request: PermissionRequest; }
export interface HistoryListEvent { list: HistorySessionMeta[]; }
export interface UndoResultEvent { chatId: string; result: UndoResultPayload; }
export interface ChangesStateEvent { chatId: string; state: ChangesState; }


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
  CHANGES_STATE: 'acp-changes-state'
};

export const ACPBridge = {
  initialize: () => {
    if (typeof window === 'undefined') return;

    window.__onContentChunk = (chunk) => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.CONTENT_CHUNK, { detail: { chunk } }));
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
  }
};
