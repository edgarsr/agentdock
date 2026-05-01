import { useCallback, useEffect, useRef } from 'react';
import type { Message, PermissionRequest } from '../../../types/chat';

interface UseChatSessionNotificationsOptions {
  messages: Message[];
  isSending: boolean;
  isHistoryReplaying: boolean;
  permissionRequest: PermissionRequest | null;
  acpSessionId: string;
  adapterName: string;
  onAssistantActivity?: () => void;
  onAtBottomChange?: (isAtBottom: boolean) => void;
  onCanMarkReadChange?: (canMarkRead: boolean) => void;
  onPermissionRequestChange?: (hasPendingPermission: boolean) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  onSessionStateChange?: (state: { acpSessionId: string; adapterName: string }) => void;
}

export function useChatSessionNotifications({
  messages,
  isSending,
  isHistoryReplaying,
  permissionRequest,
  acpSessionId,
  adapterName,
  onAssistantActivity,
  onAtBottomChange,
  onCanMarkReadChange,
  onPermissionRequestChange,
  onProcessingChange,
  onSessionStateChange,
}: UseChatSessionNotificationsOptions) {
  const lastReportedSessionStateRef = useRef('');
  const permissionRequestChangeRef = useRef(onPermissionRequestChange);
  const prevIsSendingRef = useRef(isSending);
  const pendingAssistantActivityRef = useRef(false);
  const lastNotifiedAssistantKeyRef = useRef('');

  const handleAtBottomChange = useCallback((isAtBottom: boolean) => {
    onAtBottomChange?.(isAtBottom);
  }, [onAtBottomChange]);

  const handleCanMarkReadChange = useCallback((canMarkRead: boolean) => {
    onCanMarkReadChange?.(canMarkRead);
  }, [onCanMarkReadChange]);

  useEffect(() => {
    const prev = prevIsSendingRef.current;
    prevIsSendingRef.current = isSending;

    // Mark unread only after the assistant actually stops producing output.
    if (!prev || isSending || isHistoryReplaying || messages.length === 0) return;

    const last = messages[messages.length - 1];
    if (last.role !== 'assistant') return;
    const hasFinalText = (last.content?.trim().length || 0) > 0;
    if (!hasFinalText) return;

    const assistantKey = `${last.id}:${last.content?.length || 0}`;
    if (permissionRequest) {
      pendingAssistantActivityRef.current = true;
      lastNotifiedAssistantKeyRef.current = assistantKey;
      return;
    }

    if (lastNotifiedAssistantKeyRef.current === assistantKey) return;
    lastNotifiedAssistantKeyRef.current = assistantKey;
    onAssistantActivity?.();
  }, [isSending, isHistoryReplaying, messages, onAssistantActivity, permissionRequest]);

  useEffect(() => {
    if (permissionRequest || !pendingAssistantActivityRef.current || isSending || isHistoryReplaying || messages.length === 0) return;

    const last = messages[messages.length - 1];
    if (last.role !== 'assistant') {
      pendingAssistantActivityRef.current = false;
      return;
    }

    const hasFinalText = (last.content?.trim().length || 0) > 0;
    if (!hasFinalText) {
      pendingAssistantActivityRef.current = false;
      return;
    }

    pendingAssistantActivityRef.current = false;
    onAssistantActivity?.();
  }, [permissionRequest, isSending, isHistoryReplaying, messages, onAssistantActivity]);

  useEffect(() => {
    onProcessingChange?.(isSending);
  }, [isSending, onProcessingChange]);

  useEffect(() => {
    onPermissionRequestChange?.(!!permissionRequest);
  }, [permissionRequest, onPermissionRequestChange]);

  useEffect(() => {
    permissionRequestChangeRef.current = onPermissionRequestChange;
  }, [onPermissionRequestChange]);

  useEffect(() => {
    const fingerprint = `${acpSessionId}|${adapterName}`;
    if (lastReportedSessionStateRef.current === fingerprint) return;
    lastReportedSessionStateRef.current = fingerprint;
    onSessionStateChange?.({
      acpSessionId,
      adapterName
    });
  }, [acpSessionId, adapterName, onSessionStateChange]);

  useEffect(() => {
    return () => {
      permissionRequestChangeRef.current?.(false);
    };
  }, []);

  return {
    handleAtBottomChange,
    handleCanMarkReadChange,
  };
}
