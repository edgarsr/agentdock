import { ACPBridge } from './bridge';
import type { GlobalSettings } from '../types/chat';

/** Earlier versions kept these two in localStorage, which a browser UI does not share with JCEF; they move to the settings once. */
export function migrateLocalStorageSettings(settings: GlobalSettings | undefined) {
  const approvalMode = localStorage.getItem('chat-approval-mode');
  const sendMode = localStorage.getItem('chat-send-mode');
  if (!settings || (approvalMode === null && sendMode === null)) return;
  localStorage.removeItem('chat-approval-mode');
  localStorage.removeItem('chat-send-mode');
  if (approvalMode !== 'auto' && sendMode !== 'ctrl-enter') return;
  ACPBridge.saveGlobalSettings({
    ...(approvalMode === 'auto' ? { approvalMode: 'auto' as const } : {}),
    ...(sendMode === 'ctrl-enter' ? { sendMode: 'ctrl-enter' as const } : {}),
  });
}
