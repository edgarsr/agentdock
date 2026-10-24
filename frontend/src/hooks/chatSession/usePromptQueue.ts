import { useCallback, useEffect, useRef, useState } from 'react';
import { QueuedPrompt, QueuePromptDraft } from './promptQueueTypes';

const MAX_PROMPT_QUEUE_ITEMS = 10;

interface UsePromptQueueOptions {
  canDrain: boolean;
  canPreempt: boolean;
  onDrain: (prompt: QueuedPrompt) => void;
  onPreempt: () => Promise<boolean>;
  /** The queue a restored chat had; read on mount only. */
  initialItems?: QueuedPrompt[];
}

let promptQueueCounter = 0;

function nextQueuedPromptId(): string {
  promptQueueCounter += 1;
  return `queued-${promptQueueCounter}-${Date.now()}`;
}

/** A prompt taken out of the queue keeps its ID, a new one gets one. */
export function asQueuedPrompt(prompt: QueuePromptDraft): QueuedPrompt {
  return 'id' in prompt ? prompt as QueuedPrompt : { ...prompt, id: nextQueuedPromptId() };
}

export function usePromptQueue({ canDrain, canPreempt, onDrain, onPreempt, initialItems = [] }: UsePromptQueueOptions) {
  const [items, setItems] = useState<QueuedPrompt[]>(initialItems);
  const itemsRef = useRef<QueuedPrompt[]>(initialItems);
  const onDrainRef = useRef(onDrain);
  const onPreemptRef = useRef(onPreempt);
  const preemptingRef = useRef(false);
  const drainingRef = useRef(false);
  const [isPreempting, setIsPreempting] = useState(false);

  useEffect(() => {
    if (!canDrain) drainingRef.current = false;
  }, [canDrain]);

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

  const updateItems = useCallback((updater: (prev: QueuedPrompt[]) => QueuedPrompt[]) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
    return next;
  }, []);

  const clearQueue = useCallback(() => {
    updateItems(() => []);
  }, [updateItems]);

  const enqueuePrompt = useCallback((draft: QueuePromptDraft): boolean => {
    if (itemsRef.current.length >= MAX_PROMPT_QUEUE_ITEMS) {
      return false;
    }

    updateItems((prev) => {
      const item = {
        ...draft,
        id: nextQueuedPromptId(),
        attachments: [...draft.attachments],
      };
      const scheduledAt = draft.scheduledAt;
      const index = scheduledAt === undefined ? -1 : prev.findIndex(
        (queued) => queued.scheduledAt !== undefined && queued.scheduledAt > scheduledAt,
      );
      const next = [...prev];
      next.splice(index === -1 ? next.length : index, 0, item);
      return next;
    });
    return true;
  }, [updateItems]);

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

  const sendQueuedPromptNow = useCallback((id: string) => {
    const item = itemsRef.current.find((queued) => queued.id === id);
    if (!item) return;

    if (canDrain && !drainingRef.current) {
      drainingRef.current = true;
      updateItems((prev) => prev.filter((queued) => queued.id !== id));
      onDrainRef.current(item);
      return;
    }

    updateItems((prev) => [{ ...item, scheduledAt: undefined }, ...prev.filter((queued) => queued.id !== id)]);
    if (!canPreempt || preemptingRef.current) return;

    setPreempting(true);
    onPreemptRef.current().then((accepted) => {
      setPreempting(false);
      if (!accepted) return;
    }).catch(() => {
      setPreempting(false);
    });
  }, [canDrain, canPreempt, setPreempting, updateItems]);

  const firstPrompt = items[0];
  useEffect(() => {
    if (!canDrain || isPreempting || !firstPrompt) return;
    let timer: number | undefined;
    const drainWhenDue = () => {
      window.clearTimeout(timer);
      if (drainingRef.current) return;
      const next = itemsRef.current[0];
      if (!next) return;
      const remaining = (next.scheduledAt ?? 0) - Date.now();
      if (remaining > 0) {
        // Browser timeouts use a signed 32-bit delay. Recheck the wall clock on wake.
        timer = window.setTimeout(drainWhenDue, Math.min(remaining, 2_147_483_647));
      } else {
        drainingRef.current = true;
        updateItems((prev) => prev.slice(1));
        onDrainRef.current(next);
      }
    };
    drainWhenDue();
    window.addEventListener('focus', drainWhenDue);
    document.addEventListener('visibilitychange', drainWhenDue);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', drainWhenDue);
      document.removeEventListener('visibilitychange', drainWhenDue);
    };
  }, [canDrain, isPreempting, firstPrompt, updateItems]);

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
