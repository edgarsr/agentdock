import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatAttachment, RichContentBlock } from '../../types/chat';
import { QueuedPrompt, QueuePromptDraft } from './promptQueueTypes';

const MAX_PROMPT_QUEUE_ITEMS = 10;

interface UsePromptQueueOptions {
  enabled: boolean;
  canDrain: boolean;
  canPreempt: boolean;
  onDrain: (prompt: QueuedPrompt) => void;
  onPreempt: () => Promise<boolean>;
  rebuildBlocks: (text: string, attachments: ChatAttachment[]) => RichContentBlock[];
}

let promptQueueCounter = 0;

function nextQueuedPromptId(): string {
  promptQueueCounter += 1;
  return `queued-${promptQueueCounter}-${Date.now()}`;
}

export function usePromptQueue({ enabled, canDrain, canPreempt, onDrain, onPreempt, rebuildBlocks }: UsePromptQueueOptions) {
  const [items, setItems] = useState<QueuedPrompt[]>([]);
  const itemsRef = useRef<QueuedPrompt[]>([]);
  const onDrainRef = useRef(onDrain);
  const onPreemptRef = useRef(onPreempt);
  const preemptingRef = useRef(false);
  const [isPreempting, setIsPreempting] = useState(false);

  const setPreempting = useCallback((next: boolean) => {
    preemptingRef.current = next;
    setIsPreempting(next);
  }, []);

  useEffect(() => {
    onDrainRef.current = onDrain;
  }, [onDrain]);

  useEffect(() => {
    onPreemptRef.current = onPreempt;
  }, [onPreempt]);

  useEffect(() => {
    if (!enabled) {
      setPreempting(false);
    }
  }, [enabled, setPreempting]);

  const updateItems = useCallback((updater: (prev: QueuedPrompt[]) => QueuedPrompt[]) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
    return next;
  }, []);

  const clearQueue = useCallback(() => {
    updateItems(() => []);
  }, [updateItems]);

  useEffect(() => {
    if (!enabled) {
      clearQueue();
    }
  }, [enabled, clearQueue]);

  const enqueuePrompt = useCallback((draft: QueuePromptDraft): boolean => {
    if (!enabled || itemsRef.current.length >= MAX_PROMPT_QUEUE_ITEMS) {
      return false;
    }

    updateItems((prev) => [
      ...prev,
      {
        id: nextQueuedPromptId(),
        text: draft.text,
        blocks: draft.blocks,
        attachments: [...draft.attachments],
      },
    ]);
    return true;
  }, [enabled, updateItems]);

  const removeQueuedPrompt = useCallback((id: string) => {
    updateItems((prev) => prev.filter((item) => item.id !== id));
  }, [updateItems]);

  const updateQueuedPromptText = useCallback((id: string, text: string) => {
    updateItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      return {
        ...item,
        text,
        blocks: rebuildBlocks(text, item.attachments),
      };
    }));
  }, [rebuildBlocks, updateItems]);

  const drainNextQueuedPrompt = useCallback(() => {
    if (!enabled || !canDrain || isPreempting) return false;
    const next = itemsRef.current[0];
    if (!next) return false;

    updateItems((prev) => prev.slice(1));
    onDrainRef.current(next);
    return true;
  }, [canDrain, enabled, isPreempting, updateItems]);

  const sendQueuedPromptNow = useCallback((id: string) => {
    const item = itemsRef.current.find((queued) => queued.id === id);
    if (!item) return;

    if (canDrain) {
      updateItems((prev) => prev.filter((queued) => queued.id !== id));
      onDrainRef.current(item);
      return;
    }

    updateItems((prev) => [item, ...prev.filter((queued) => queued.id !== id)]);
    if (!enabled || !canPreempt || preemptingRef.current) return;

    setPreempting(true);
    onPreemptRef.current().then((accepted) => {
      setPreempting(false);
      if (!accepted) return;
    }).catch(() => {
      setPreempting(false);
    });
  }, [canDrain, canPreempt, enabled, setPreempting, updateItems]);

  useEffect(() => {
    drainNextQueuedPrompt();
  }, [drainNextQueuedPrompt, items.length]);

  return {
    queuedPrompts: items,
    enqueuePrompt,
    clearQueue,
    removeQueuedPrompt,
    updateQueuedPromptText,
    sendQueuedPromptNow,
  };
}
