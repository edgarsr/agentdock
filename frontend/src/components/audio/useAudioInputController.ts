import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioRecordingStatePayload } from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';

interface AudioInputControllerProps {
  conversationId: string;
  insertTranscript: (text: string) => void;
}

function formatAudioError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : String(error ?? '').trim();
  return `[${message || 'Error'}]`;
}

export function useAudioInputController({
  conversationId,
  insertTranscript,
}: AudioInputControllerProps) {
  const ownerId = useMemo(() => `audio-${conversationId}-${Date.now()}-${Math.random()}`, [conversationId]);
  const insertTranscriptRef = useRef(insertTranscript);
  const requestCounterRef = useRef(0);
  const activeRequestRef = useRef<string | null>(null);
  const cancellationRequestedRef = useRef<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  insertTranscriptRef.current = insertTranscript;

  useEffect(() => {
    const cleanupRecording = ACPBridge.onAudioRecordingState((e) => {
      const payload: AudioRecordingStatePayload = e.detail.payload;
      if (payload.ownerId !== ownerId) return;
      setIsRecording(payload.recording);
      if (payload.error) {
        console.error('[ChatInput] Audio recording error:', payload.error);
        insertTranscriptRef.current(formatAudioError(payload.error));
      }
    });

    return () => {
      cleanupRecording();
    };
  }, [ownerId]);

  useEffect(() => {
    return () => {
      const requestId = activeRequestRef.current;
      if (requestId) {
        cancellationRequestedRef.current = requestId;
        ACPBridge.cancelAudioTranscription(requestId);
      }
      ACPBridge.cancelAudioRecording(ownerId);
    };
  }, [ownerId]);

  const handleVoiceInput = useCallback(async () => {
    if (isTranscribing) return;

    if (isRecording) {
      requestCounterRef.current += 1;
      const requestId = `${ownerId}-request-${requestCounterRef.current}`;
      activeRequestRef.current = requestId;
      cancellationRequestedRef.current = null;
      setIsTranscribing(true);
      try {
        const result = await ACPBridge.stopAudioRecording(requestId, ownerId);
        if (
          !result.cancelled &&
          activeRequestRef.current === requestId &&
          cancellationRequestedRef.current !== requestId
        ) {
          insertTranscriptRef.current(result.text || '');
        }
      } catch (error) {
        console.error('[ChatInput] Voice transcription failed:', error);
        if (
          activeRequestRef.current === requestId &&
          cancellationRequestedRef.current !== requestId
        ) {
          insertTranscriptRef.current(formatAudioError(error));
        }
      } finally {
        if (activeRequestRef.current === requestId) {
          activeRequestRef.current = null;
        }
        if (cancellationRequestedRef.current === requestId) {
          cancellationRequestedRef.current = null;
        }
        setIsRecording(false);
        setIsTranscribing(false);
      }
      return;
    }

    try {
      ACPBridge.startAudioRecording(ownerId);
      setIsRecording(true);
    } catch (error) {
      console.error('[ChatInput] Unable to start audio capture:', error);
      setIsRecording(false);
    }
  }, [isRecording, isTranscribing, ownerId]);

  const handleCancelVoiceInput = useCallback(() => {
    const requestId = activeRequestRef.current;
    if (!requestId || cancellationRequestedRef.current === requestId) return;

    cancellationRequestedRef.current = requestId;
    ACPBridge.cancelAudioTranscription(requestId);
    ACPBridge.cancelAudioRecording(ownerId);
  }, [ownerId]);

  return {
    isTranscribing,
    isRecording,
    handleVoiceInput,
    handleCancelVoiceInput,
  };
}
