import { useEffect, useState } from 'react';
import { ACPBridge } from '../utils/bridge';

/**
 * Maps conversationId -> projectPath for conversations that exist in the history index.
 * A conversation is only listed after its first prompt, so this doubles as the
 * "conversation is registered and can be renamed" signal.
 */
export function useHistoryConversationIndex(): Map<string, string> {
  const [index, setIndex] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    return ACPBridge.onHistoryList((e) => {
      const next = new Map(
        e.detail.list
          .filter((item) => item.conversationId && item.projectPath)
          .map((item) => [item.conversationId, item.projectPath] as const)
      );

      setIndex((prev) => {
        if (prev.size === next.size && Array.from(next).every(([id, path]) => prev.get(id) === path)) {
          return prev;
        }
        return next;
      });
    });
  }, []);

  return index;
}
