import { useCallback, useEffect, useRef, useState } from 'react';
import { QueuedPrompt, QueuePromptDraft } from './promptQueueTypes';

const MAX_PROMPT_QUEUE_ITEMS = 10;

interface UsePromptQueueOptions {
  enabled: boolean;
  canDrain: boolean;
  canPreempt: boolean;
  onDrain: (prompt: QueuedPrompt) => void;
  onPreempt: () => Promise<boolean>;
}

let promptQueueCounter = 0;

function nextQueuedPromptId(): string {
  promptQueueCounter += 1;
  return `queued-${promptQueueCounter}-${Date.now()}`;
}

export function usePromptQueue({ enabled, canDrain, canPreempt, onDrain, onPreempt }: UsePromptQueueOptions) {
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
        composerText: draft.composerText,
        blocks: draft.blocks,
        attachments: [...draft.attachments],
      },
    ]);
    return true;
  }, [enabled, updateItems]);

  const removeQueuedPrompt = useCallback((id: string) => {
    updateItems((prev) => prev.filter((item) => item.id !== id));
  }, [updateItems]);

  const takeQueuedPrompt = useCallback((id: string): QueuedPrompt | undefined => {
    const item = itemsRef.current.find((queued) => queued.id === id);
    if (!item) return undefined;
    updateItems((prev) => prev.filter((queued) => queued.id !== id));
    return item;
  }, [updateItems]);

  const reorderQueuedPrompt = useCallback((
    draggedId: string,
    targetId: string,
    position: 'before' | 'after',
  ) => {
    if (draggedId === targetId) return;

    updateItems((prev) => {
      const draggedPrompt = prev.find((item) => item.id === draggedId);
      if (!draggedPrompt || !prev.some((item) => item.id === targetId)) return prev;

      const withoutDragged = prev.filter((item) => item.id !== draggedId);
      const targetIndex = withoutDragged.findIndex((item) => item.id === targetId);
      if (targetIndex === -1) return prev;

      const next = [...withoutDragged];
      next.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, draggedPrompt);
      return next;
    });
  }, [updateItems]);

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
    takeQueuedPrompt,
    reorderQueuedPrompt,
    sendQueuedPromptNow,
  };
}
