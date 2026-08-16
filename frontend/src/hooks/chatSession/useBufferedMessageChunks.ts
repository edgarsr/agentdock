import { Dispatch, SetStateAction, useCallback, useRef } from 'react';
import { ContentChunk, Message } from '../../types/chat';
import { applyChunks, closeAllStreamingThinking } from './messageProcessing';

type UseBufferedMessageChunksArgs = {
  setHistoryMessages: Dispatch<SetStateAction<Message[]>>;
  setLiveMessages: Dispatch<SetStateAction<Message[]>>;
};

export function useBufferedMessageChunks({
  setHistoryMessages,
  setLiveMessages,
}: UseBufferedMessageChunksArgs) {
  const chunkBufferRef = useRef<ContentChunk[]>([]);
  const flushScheduledRef = useRef(false);

  const applyBufferedChunks = useCallback((reason: string) => {
    const chunks = chunkBufferRef.current;
    chunkBufferRef.current = [];
    if (chunks.length === 0 && reason !== 'status-ready') return;

    // Buffered chunks are always live agent output; stored conversations are applied
    // to history messages in one piece when the replay payload arrives.
    if (reason === 'status-ready') {
      setHistoryMessages(closeAllStreamingThinking);
    }

    setLiveMessages(prev => {
      const result = chunks.length > 0 ? applyChunks(prev, chunks) : prev;
      return reason === 'status-ready' ? closeAllStreamingThinking(result) : result;
    });
  }, [setHistoryMessages, setLiveMessages]);

  const flushChunks = useCallback(() => {
    flushScheduledRef.current = false;
    applyBufferedChunks('raf');
  }, [applyBufferedChunks]);

  const enqueueChunk = useCallback((chunk: ContentChunk) => {
    chunkBufferRef.current.push(chunk);
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      requestAnimationFrame(flushChunks);
    }
  }, [flushChunks]);

  const clearBufferedChunks = useCallback(() => {
    chunkBufferRef.current = [];
    flushScheduledRef.current = false;
  }, []);

  const markFlushUnscheduled = useCallback(() => {
    flushScheduledRef.current = false;
  }, []);

  return {
    applyBufferedChunks,
    enqueueChunk,
    clearBufferedChunks,
    markFlushUnscheduled,
  };
}
