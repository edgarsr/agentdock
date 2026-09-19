import { Dispatch, SetStateAction, useEffect } from 'react';
import type { ChatTab, HistorySessionMeta } from '../types/chat';

export function useHistoryTitleSync(
  setTabs: Dispatch<SetStateAction<ChatTab[]>>,
  historyList: HistorySessionMeta[]
) {
  useEffect(() => {
    const historyByConversationId = new Map(
      historyList
        .filter((item) => item.conversationId && item.title?.trim())
        .map((item) => [item.conversationId, item])
    );

    setTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        const conversationKey = tab.historySession?.conversationId || tab.conversationId;
        const historyItem = historyByConversationId.get(conversationKey);
        const nextTitle = historyItem?.title?.trim();
        if (!nextTitle || nextTitle === tab.title) {
          if (!historyItem || !tab.historySession) return tab;
          if (tab.historySession.title === historyItem.title) return tab;
          changed = true;
          return {
            ...tab,
            historySession: {
              ...tab.historySession,
              title: historyItem.title,
            }
          };
        }

        changed = true;
        if (!tab.historySession) {
          return { ...tab, title: nextTitle };
        }

        return {
          ...tab,
          title: nextTitle,
          historySession: historyItem
        };
      });

      return changed ? next : prev;
    });
  }, [historyList, setTabs]);
}
