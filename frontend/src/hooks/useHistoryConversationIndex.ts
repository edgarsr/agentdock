import { useMemo } from 'react';
import type { HistorySessionMeta } from '../types/chat';

/**
 * Maps conversationId -> projectPath for conversations that exist in the history index.
 * A conversation is only listed after its first prompt, so this doubles as the
 * "conversation is registered and can be renamed" signal.
 */
export function useHistoryConversationIndex(historyList: HistorySessionMeta[]): Map<string, string> {
  return useMemo(() => new Map(
    historyList
      .filter((item) => item.conversationId && item.projectPath)
      .map((item) => [item.conversationId, item.projectPath] as const)
  ), [historyList]);
}
