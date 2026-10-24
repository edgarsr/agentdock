import { useEffect, useState } from 'react';

const STORAGE_KEY = 'agent-dock.sidebar-enabled';
const CHANGE_EVENT = 'agent-dock-sidebar-layout';

const readSidebarEnabled = () => localStorage.getItem(STORAGE_KEY) !== 'false';

/** Whether the sidebar or the tab bar is shown; each browser and the IDE keep their own choice. */
export function useSidebarLayout(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(readSidebarEnabled);
  useEffect(() => {
    const onChange = () => setEnabled(readSidebarEnabled());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);
  const setSidebarEnabled = (next: boolean) => {
    localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return [enabled, setSidebarEnabled];
}
