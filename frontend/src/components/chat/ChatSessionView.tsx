import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useChatSession } from '../../hooks/useChatSession';
import { useFileChanges } from '../../hooks/useFileChanges';
import { AgentOption, FileChangeSummary, HistorySessionMeta, PendingHandoffContext } from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import { Check, Copy, Download, X } from 'lucide-react';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import PermissionBar from './PermissionBar';
import FileChangesPanel from './FileChangesPanel';
import ConfirmationModal from '../ConfirmationModal';
import { Tooltip } from './shared/Tooltip';
import { buildConversationHandoffFromTranscriptFile, buildConversationHandoffSaveFailureContext, prepareConversationHandoff } from '../../utils/conversationHandoff';

interface ChatSessionProps {
  initialAgentId?: string;
  conversationId: string;
  availableAgents: AgentOption[];
  historySession?: HistorySessionMeta;
  pendingHandoff?: PendingHandoffContext;
  isActive?: boolean;
  onAssistantActivity?: () => void;
  onAtBottomChange?: (isAtBottom: boolean) => void;
  onCanMarkReadChange?: (canMarkRead: boolean) => void;
  onPermissionRequestChange?: (hasPendingPermission: boolean) => void;
  onAgentChangeRequest?: (payload: { agentId: string; handoffText: string }) => void;
  onHandoffConsumed?: (handoffId: string) => void;
  onSessionStateChange?: (state: { acpSessionId: string; adapterName: string }) => void;
}

export default function ChatSessionView({ 
  initialAgentId, 
  conversationId,
  availableAgents,
  historySession,
  pendingHandoff,
  isActive = false,
  onAssistantActivity,
  onAtBottomChange,
  onCanMarkReadChange,
  onPermissionRequestChange,
  onAgentChangeRequest,
  onHandoffConsumed,
  onSessionStateChange
}: ChatSessionProps) {
  const {
    messages,
    inputValue,
    setInputValue,
    status,
    isSending,
    isHistoryReplaying,
    agentOptions,
    selectedAgentId,
    selectedModelId,
    handleModelChange,
    modeOptions,
    selectedModeId,
    handleModeChange,
    permissionRequest,
    handleSend,
    handleStop,
    handlePermissionDecision,
    hasSelectedAgent,
    attachments,
    setAttachments,
    availableCommands,
    acpSessionId,
    adapterName,
    adapterDisplayName,
    adapterIconPath
  } = useChatSession(conversationId, availableAgents, initialAgentId, historySession, pendingHandoff, onHandoffConsumed);

  const {
    hasPluginEdits,
    fileChanges,
    totalAdditions,
    totalDeletions,
    undoErrorMessage,
    clearUndoError,
    handleUndoFile,
    handleUndoAllFiles,
    handleKeepFile,
    handleKeepAll,
  } = useFileChanges(conversationId, acpSessionId, adapterName);

  const lastAssistantMsgWithContext = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && (msg.contextTokensUsed !== undefined || msg.contextWindowSize !== undefined)) {
        if (!selectedAgentId || msg.agentId === selectedAgentId) {
          return msg;
        }
        return null; // The latest context is from a different agent, so wait for the current agent context.
      }
    }
    return null;
  }, [messages, selectedAgentId]);

  const handleShowDiff = useCallback((fc: FileChangeSummary) => {
    if (typeof window.__showDiff === 'function') {
      window.__showDiff(JSON.stringify({
        filePath: fc.filePath,
        status: fc.status,
        operations: fc.operations,
      }));
    }
  }, []);

  const handleOpenFile = useCallback((filePath: string) => {
    if (typeof window.__openFile === 'function') {
      window.__openFile(JSON.stringify({ filePath }));
    }
  }, []);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [overlayActionState, setOverlayActionState] = useState<'downloaded' | 'copied' | null>(null);
  const lastReportedSessionStateRef = useRef('');
  const permissionRequestChangeRef = useRef(onPermissionRequestChange);
  const overlayActionTimerRef = useRef<number | null>(null);
  const overlayPrimaryActionRef = useRef<HTMLButtonElement | null>(null);

  const clearOverlayActionState = useCallback(() => {
    if (overlayActionTimerRef.current !== null) {
      window.clearTimeout(overlayActionTimerRef.current);
      overlayActionTimerRef.current = null;
    }
    setOverlayActionState(null);
  }, []);

  const flashOverlayActionState = useCallback((state: 'downloaded' | 'copied') => {
    clearOverlayActionState();
    setOverlayActionState(state);
    overlayActionTimerRef.current = window.setTimeout(() => {
      overlayActionTimerRef.current = null;
      setOverlayActionState(null);
    }, 1800);
  }, [clearOverlayActionState]);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    flashOverlayActionState('downloaded');
  };

  const handleCopyImage = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedImage || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      return;
    }

    try {
      const response = await fetch(selectedImage);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type || 'image/png']: blob,
        }),
      ]);
      flashOverlayActionState('copied');
    } catch (error) {
      console.warn('[ChatSessionView] Failed to copy image:', error);
    }
  }, [flashOverlayActionState, selectedImage]);

  // --- Resizing Logic ---
  const INPUT_MIN_HEIGHT = 120;
  const INPUT_MIN_HEIGHT_WITH_ATTACHMENTS = 192;
  const INPUT_MAX_HEIGHT = 424;
  const INPUT_DEFAULT_HEIGHT = 180;
  const INPUT_BOTTOM_BAR_BUFFER = 70;
  const ATTACHMENT_BAR_HEIGHT = 48;
  const MAX_HEIGHT_RATIO = 0.8;

  const [inputHeight, setInputHeight] = useState(INPUT_DEFAULT_HEIGHT);
  const [contentHeight, setContentHeight] = useState(0);
  const isResizingRef = useRef(false);
  const [isManualSize, setIsManualSize] = useState(false);

  const handleMouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const handleMouseUpRef = useRef<(() => void) | null>(null);

  const stopResizing = useCallback(() => {
    isResizingRef.current = false;
    document.body.style.cursor = 'default';
    if (handleMouseMoveRef.current) {
      document.removeEventListener('mousemove', handleMouseMoveRef.current);
    }
    if (handleMouseUpRef.current) {
      document.removeEventListener('mouseup', handleMouseUpRef.current);
    }
  }, []);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    setIsManualSize(true);
    document.body.style.cursor = 'row-resize';

    handleMouseMoveRef.current = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newHeight = window.innerHeight - ev.clientY;
      const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;
      const clampedHeight = Math.max(INPUT_MIN_HEIGHT, Math.min(newHeight, maxHeight));
      setInputHeight(clampedHeight);
    };

    handleMouseUpRef.current = stopResizing;

    document.addEventListener('mousemove', handleMouseMoveRef.current);
    document.addEventListener('mouseup', handleMouseUpRef.current);
  }, [stopResizing]);

  // Auto-sizing logic: Grow and shrink to fit content
  useEffect(() => {
    if (isManualSize) return;

    const hasAttachmentBar = attachments.some(a => !a.isInline);
    const extraHeight = hasAttachmentBar ? ATTACHMENT_BAR_HEIGHT : 0;

    const totalContentNeeded = contentHeight + INPUT_BOTTOM_BAR_BUFFER + extraHeight;
    const maxHeightLimit = Math.min(INPUT_MAX_HEIGHT, window.innerHeight * MAX_HEIGHT_RATIO);
    const minTarget = hasAttachmentBar ? INPUT_MIN_HEIGHT_WITH_ATTACHMENTS : INPUT_MIN_HEIGHT;
    const clampedTarget = Math.max(minTarget, Math.min(totalContentNeeded, maxHeightLimit));

    setInputHeight(clampedTarget);
  }, [contentHeight, isManualSize, attachments]);

  useEffect(() => {
    return () => {
      stopResizing();
    };
  }, [stopResizing]);

  const handleAtBottomChange = useCallback((isAtBottom: boolean) => {
    onAtBottomChange?.(isAtBottom);
  }, [onAtBottomChange]);

  const handleCanMarkReadChange = useCallback((canMarkRead: boolean) => {
    onCanMarkReadChange?.(canMarkRead);
  }, [onCanMarkReadChange]);

  const prevIsSendingRef = useRef(isSending);
  const pendingAssistantActivityRef = useRef(false);
  const lastNotifiedAssistantKeyRef = useRef('');

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
      clearOverlayActionState();
    };
  }, [clearOverlayActionState]);

  useEffect(() => {
    clearOverlayActionState();
  }, [selectedImage, clearOverlayActionState]);

  useEffect(() => {
    if (!selectedImage) return;
    requestAnimationFrame(() => {
      overlayPrimaryActionRef.current?.focus();
    });
  }, [selectedImage]);

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-background">
      {/* Message List Area with Scoped Overlay */}
      <div className="flex-1 flex flex-col min-h-0 relative">

        <div className={`flex-1 flex flex-col min-h-0`}>
          <MessageList 
            messages={messages} 
            onImageClick={setSelectedImage} 
            onAtBottomChange={handleAtBottomChange}
            onCanMarkReadChange={handleCanMarkReadChange}
            isSending={isSending}
            status={status}
            agentName={adapterDisplayName}
            agentIconPath={adapterIconPath}
            availableAgents={availableAgents}
            isHistoryReplaying={isHistoryReplaying}
          />
        </div>
      </div>

      <div className="flex flex-col shrink-0 relative z-20 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] bg-background">
        <FileChangesPanel
          hasPluginEdits={hasPluginEdits}
          fileChanges={fileChanges}
          totalAdditions={totalAdditions}
          totalDeletions={totalDeletions}
          onUndoFile={handleUndoFile}
          onUndoAllFiles={handleUndoAllFiles}
          onKeepFile={handleKeepFile}
          onKeepAll={handleKeepAll}
          onOpenFile={handleOpenFile}
          onShowDiff={handleShowDiff}
        />

        {permissionRequest && (
          <PermissionBar
            request={permissionRequest}
            onRespond={handlePermissionDecision}
          />
        )}

        {/* Resize Handle / Divider */}
        <div 
          onMouseDown={startResizing}
          className="h-[12px] -my-[6px] w-full cursor-row-resize relative z-10 group select-none"
        >
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px]
            bg-[var(--ide-Borders-ContrastBorderColor)] transition-[background-color,box-shadow] duration-500
            delay-150 ease-out group-hover:bg-[var(--ide-Button-default-focusColor)]
            group-hover:shadow-[0_0_4px_color-mix(in_srgb,var(--ide-Button-default-focusColor),transparent_55%)]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-[2px]
            bg-[var(--ide-Borders-ContrastBorderColor)] rounded-full transition-[background-color,box-shadow]
            duration-500 delay-150 ease-out group-hover:bg-[var(--ide-Button-default-focusColor)]
            group-hover:shadow-[0_0_6px_color-mix(in_srgb,var(--ide-Button-default-focusColor),transparent_45%)]" />
        </div>

        <div style={{ height: `${inputHeight}px` }} className="flex flex-col">
          <ChatInput
            conversationId={conversationId}
            contextTokensUsed={lastAssistantMsgWithContext?.contextTokensUsed}
            contextWindowSize={lastAssistantMsgWithContext?.contextWindowSize}
            inputValue={inputValue}
            onInputChange={setInputValue}
            onSend={handleSend}
            onStop={handleStop}
            isSending={isSending}
            usageSessionKey={acpSessionId || undefined}
            status={status}
            
            agentOptions={agentOptions}
            selectedAgentId={selectedAgentId}
            onAgentChange={async (id) => {
              if (!onAgentChangeRequest || id === selectedAgentId) return;

              const prepared = prepareConversationHandoff(messages, fileChanges);
              let handoffText = prepared.handoffText;

              if (prepared.exceedsInlineLimit) {
                try {
                  const saved = await ACPBridge.saveConversationTranscript(conversationId, prepared.normalizedTranscript);
                  handoffText = buildConversationHandoffFromTranscriptFile(prepared, saved.filePath || '');
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  console.warn('[ChatSessionView] Failed to persist handoff transcript:', error);
                  handoffText = buildConversationHandoffSaveFailureContext(prepared, message);
                }
              }

              onAgentChangeRequest({
                agentId: id,
                handoffText,
              });
            }}
            
            selectedModelId={selectedModelId}
            onModelChange={handleModelChange}
            
            modeOptions={modeOptions}
            selectedModeId={selectedModeId}
            onModeChange={handleModeChange}
            
            hasSelectedAgent={hasSelectedAgent}
            availableCommands={availableCommands}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onImageClick={setSelectedImage}
            onHeightChange={setContentHeight}
            customHeight={inputHeight}
            autoFocus={isActive}
            isActive={isActive}
          />
        </div>
      </div>

      {/* Full-size Image Overlay */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black bg-opacity-50 flex items-center
            justify-center p-8 animate-in fade-in duration-200 cursor-zoom-out"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="absolute right-4 top-16 z-10 flex items-center gap-1.5 px-2 py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip content="Copy" variant="minimal">
              <button
                ref={overlayPrimaryActionRef}
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded bg-secondary text-foreground
                transition-colors hover:bg-hover hover:text-foreground focus:outline-none
                focus-visible:ring-2focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                onClick={handleCopyImage}
              >
                {overlayActionState === 'copied' ? <Check size={13} /> : <Copy size={16} />}
              </button>
            </Tooltip>
            <Tooltip content="Download" variant="minimal">
              <a href={selectedImage} download="image.png"
                className="flex h-8 w-8 items-center justify-center rounded bg-secondary text-foreground
                transition-colors hover:bg-hover hover:text-foreground focus:outline-none focus-visible:ring-2
                focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                onClick={handleDownload}
              >
                {overlayActionState === 'downloaded' ? <Check size={14} /> : <Download size={16} />}
              </a>
            </Tooltip>
            <Tooltip content="Close" variant="minimal">
              <button type="button"
                className="flex h-8 w-8 items-center justify-center rounded bg-secondary text-foreground
                transition-colors hover:bg-hover hover:text-foreground focus:outline-none focus-visible:ring-2
                focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                onClick={(e) => { e.stopPropagation(); setSelectedImage(null); }}
              >
                <X size={14} />
              </button>
            </Tooltip>
          </div>

          <div className="relative max-w-full max-h-full flex items-center justify-center">
            <img src={selectedImage} tabIndex={0}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-200
              focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4
              focus-visible:ring-offset-black"
            />
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={undoErrorMessage !== null}
        title="Undo Failed"
        message={undoErrorMessage || ''}
        confirmLabel="OK"
        showCancelButton={false}
        onConfirm={clearUndoError}
        onCancel={clearUndoError}
      />
    </div>
  );
}


