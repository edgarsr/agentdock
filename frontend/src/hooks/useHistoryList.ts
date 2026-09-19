import { useEffect, useState } from 'react';
import type { HistorySessionMeta } from '../types/chat';
import { ACPBridge } from '../utils/bridge';

export function useHistoryList(enabled: boolean) {
  const [historyList, setHistoryList] = useState<HistorySessionMeta[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => ACPBridge.onHistoryList((event) => {
    setHistoryList(Array.isArray(event.detail.list) ? event.detail.list : []);
    setHistoryLoaded(true);
  }), []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    ACPBridge.requestHistoryList();
  }, [enabled]);

  return { historyList, historyLoaded };
}
