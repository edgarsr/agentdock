import { ApprovalMode, ChatAttachment, ChatTab, PendingHandoffContext } from '../types/chat';
import { QueuedPrompt } from '../hooks/chatSession/promptQueueTypes';

/** What only the page knows about a chat; the backend restores its conversation. */
export interface ChatWorkspaceState {
  inputValue: string;
  attachments: ChatAttachment[];
  scheduleEnabled: boolean;
  scheduledAt?: number;
  approvalMode: ApprovalMode;
  configValues: Record<string, string>;
  /** A prompt still waiting for the agent to start comes first. */
  queuedPrompts: QueuedPrompt[];
}

interface AppWorkspaceState {
  chats: ChatTab[];
  activeTabId: string;
  pendingHandoffsByTab: Record<string, PendingHandoffContext>;
}

export interface UiWorkspace extends AppWorkspaceState {
  /** Keyed by the chats' conversation IDs. */
  chatStates: Record<string, ChatWorkspaceState>;
}

const SAVE_DELAY_MS = 500;

let restored: UiWorkspace | null = null;
let appState: AppWorkspaceState | null = null;
const chatStates = new Map<string, () => ChatWorkspaceState>();
let saveTimer: number | undefined;

function save() {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  // A page that no longer shows the UI would overwrite the other page's workspace, also while it reloads to take over;
  // one that has lost the IDE, and with it the chats' states, would overwrite them with none.
  if (!appState || window.__agentDockElsewhere || window.__agentDockDisconnected) return;
  const open = appState.chats.filter((chat) => !chat.closed).map((chat) => chat.conversationId);
  const workspace: UiWorkspace = {
    ...appState,
    chatStates: Object.fromEntries(open.flatMap((id) => {
      const state = chatStates.get(id);
      return state ? [[id, state()]] : [];
    })),
  };
  window.__saveUiWorkspace?.(JSON.stringify(workspace));
}

function scheduleSave() {
  if (saveTimer === undefined) saveTimer = window.setTimeout(save, SAVE_DELAY_MS);
}

// A reload has to find the latest state, including what changed within the save delay.
window.addEventListener('pagehide', save);

/**
 * The page's open chats, drafts and queued prompts, kept by the client while the page is reloaded
 * or handed to another UI. The conversations themselves come from the backend.
 */
export const uiWorkspace = {
  /** Resolves with the saved workspace, or null when there is none or it cannot be read. */
  load(): Promise<UiWorkspace | null> {
    return new Promise((resolve) => {
      const request = () => {
        window.removeEventListener('settings-bridge-ready', request);
        window.__onUiWorkspace = (json) => {
          window.__onUiWorkspace = undefined;
          try {
            restored = json ? JSON.parse(json) as UiWorkspace : null;
          } catch {
            restored = null;
          }
          if (!Array.isArray(restored?.chats)) restored = null;
          resolve(restored);
        };
        window.__loadUiWorkspace?.();
      };
      if (window.__settingsBridgeReady) request();
      else window.addEventListener('settings-bridge-ready', request);
    });
  },

  restoredChatState(conversationId: string): ChatWorkspaceState | undefined {
    return restored?.chatStates?.[conversationId];
  },

  setApp(state: AppWorkspaceState) {
    appState = state;
    scheduleSave();
  },

  /** Registers the reader of a chat's state; returns its removal. */
  registerChat(conversationId: string, read: () => ChatWorkspaceState) {
    chatStates.set(conversationId, read);
    return () => {
      if (chatStates.get(conversationId) === read) chatStates.delete(conversationId);
    };
  },

  changed: scheduleSave,

  /** Saves once the current render has finished, for changes a restored page must not repeat, such as a sent prompt. */
  saveSoon() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, 0);
  },

  /** Saves now, before the UI moves to another page. */
  save,
};
