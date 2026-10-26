import { useEffect, useRef } from 'react';
import type { SectionType, ShortcutSettings } from '../types/chat';
import { ACPBridge } from '../utils/bridge';

export type ShortcutAction = Exclude<keyof ShortcutSettings, 'tabNumbers'>;

//noinspection JSDeprecatedSymbols
export const isMac = /mac/i.test(navigator.platform);

const shortcutSettings = () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.shortcuts;

// Ctrl or Cmd alone, as the IDE forwards the plugin shortcuts.
const isCommandKey = (event: KeyboardEvent) => event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey;

// The key code is the one the IDE forwards the shortcut by, so it matches on any keyboard layout.
export function isShortcut(event: KeyboardEvent, action: ShortcutAction): boolean {
  const letter = shortcutSettings()?.[action];
  //noinspection JSDeprecatedSymbols
  return Boolean(letter) && isCommandKey(event) && event.keyCode === letter!.charCodeAt(0);
}

// The chat number of Ctrl/Cmd+1…9 while those shortcuts are on.
export function chatNumberShortcut(event: KeyboardEvent): number | null {
  //noinspection JSDeprecatedSymbols
  const number = event.keyCode - 48;
  return shortcutSettings()?.tabNumbers && isCommandKey(event) && number >= 1 && number <= 9 ? number : null;
}

// Window keydown listener while enabled; the events the handler accepts lose their default action.
export function useKeyDown(handler: (event: KeyboardEvent) => boolean, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (handlerRef.current(event)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

// Once the chat has rendered as active, so the arrow keys scroll its messages.
export const focusChatOutput = () => requestAnimationFrame(() => {
  document.querySelector<HTMLElement>('[data-active-chat-output]')?.focus({ preventScroll: true });
});

interface AppShortcutsOptions {
  // In the order the shortcut numbers follow.
  chats: { id: string }[];
  activeChatId: string;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onCloseChat: (id: string) => void;
  onOpenSection: (section: SectionType) => void;
  onOpenSettings: () => void;
}

// The shortcuts that work outside the chats: chat numbers, a new chat, closing the active one, the history and Settings.
export function useAppShortcuts({
  chats, activeChatId, onSelectChat, onNewChat, onCloseChat, onOpenSection, onOpenSettings,
}: AppShortcutsOptions) {
  useKeyDown((event) => {
    const chatNumber = chatNumberShortcut(event);
    if (chatNumber !== null) {
      const chat = chats[chatNumber - 1];
      if (!chat) return true;
      onSelectChat(chat.id);
      focusChatOutput();
    } else if (isShortcut(event, 'newChat')) {
      onNewChat();
      focusChatOutput();
    } else if (isShortcut(event, 'closeChat')) {
      if (activeChatId) onCloseChat(activeChatId);
    } else if (isShortcut(event, 'history')) {
      onOpenSection('history');
    } else if (isShortcut(event, 'manage')) {
      onOpenSettings();
    } else {
      return false;
    }
    return true;
  });
}
