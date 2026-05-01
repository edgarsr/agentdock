import { useCallback, useEffect, useMemo } from 'react';
import { useChatSession } from '../../hooks/useChatSession';
import { useFileChanges } from '../../hooks/useFileChanges';
import { AgentOption, FileChangeSummary, HistorySessionMeta, Message, PendingHandoffContext } from '../../types/chat';
import { Check, Copy, Download, X } from 'lucide-react';
import { acquireJcefLivePromptRepaint } from '../../utils/jcefHostRepaint';
import {
  buildConversationHandoffFromTranscriptFile,
  buildConversationHandoffSaveFailureContext,
  prepareConversationHandoff,
} from '../../utils/conversationHandoff';
import { ACPBridge } from '../../utils/bridge';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import PermissionBar from './PermissionBar';
import FileChangesPanel from './FileChangesPanel';
import ConfirmationModal from '../ConfirmationModal';
import { Tooltip } from './shared/Tooltip';
import { useAgentHandoffRequest } from './session/useAgentHandoffRequest';
import { useChatInputResize } from './session/useChatInputResize';
import { useChatSessionNotifications } from './session/useChatSessionNotifications';
import { useImageOverlayActions } from './session/useImageOverlayActions';

interface ChatSessionProps {
  initialAgentId?: string;
  conversationId: string;
  availableAgents: AgentOption[];
  historySession?: HistorySessionMeta;
  pendingHandoff?: PendingHandoffContext;
  initialMessages?: Message[];
  metadataTitleOverride?: string;
  isActive?: boolean;
  onUserMessageSent?: () => void;
  onAssistantActivity?: () => void;
  onAtBottomChange?: (isAtBottom: boolean) => void;
  onCanMarkReadChange?: (canMarkRead: boolean) => void;
  onPermissionRequestChange?: (hasPendingPermission: boolean) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  onAgentChangeRequest?: (payload: { agentId: string; handoffText: string }) => void;
  onForkRequest?: (payload: { agentId: string; messages: Message[]; handoffText: string }) => void;
  onHandoffConsumed?: (handoffId: string) => void;
  onSessionStateChange?: (state: { acpSessionId: string; adapterName: string }) => void;
}

export default function ChatSessionView({ 
  initialAgentId, 
  conversationId,
  availableAgents,
  historySession,
  pendingHandoff,
  initialMessages,
  metadataTitleOverride,
  isActive = false,
  onUserMessageSent,
  onAssistantActivity,
  onAtBottomChange,
  onCanMarkReadChange,
  onPermissionRequestChange,
  onProcessingChange,
  onAgentChangeRequest,
  onForkRequest,
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
  } = useChatSession(
    conversationId,
    availableAgents,
    initialAgentId,
    historySession,
    pendingHandoff,
    initialMessages,
    metadataTitleOverride,
    onHandoffConsumed,
    onUserMessageSent
  );

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

  const {
    inputHeight,
    setContentHeight,
    startResizing,
  } = useChatInputResize(attachments);

  const {
    selectedImage,
    setSelectedImage,
    closeSelectedImage,
    overlayActionState,
    overlayPrimaryActionRef,
    handleDownload,
    handleCopyImage,
  } = useImageOverlayActions();

  const {
    handleAtBottomChange,
    handleCanMarkReadChange,
  } = useChatSessionNotifications({
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
  });

  useEffect(() => {
    if (!isActive || isHistoryReplaying || status !== 'prompting') return;
    return acquireJcefLivePromptRepaint();
  }, [isActive, isHistoryReplaying, status]);

  const handleAgentChange = useAgentHandoffRequest({
    conversationId,
    selectedAgentId,
    messages,
    fileChanges,
    onAgentChangeRequest,
  });

  const handleForkFromMessage = useCallback((messageId: string) => {
    if (!onForkRequest || !selectedAgentId || messages.length === 0) return;

    const messageIndex = messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) return;

    let endExclusive = messageIndex + 1;
    if (messages[messageIndex].role === 'user' && messages[messageIndex + 1]?.role === 'assistant') {
      endExclusive += 1;
    }

    const forkMessages = messages.slice(0, endExclusive);
    const prepared = prepareConversationHandoff(forkMessages, []);

    const finish = (handoffText: string) => {
      onForkRequest({
        agentId: selectedAgentId,
        messages: forkMessages,
        handoffText,
      });
    };

    if (!prepared.exceedsInlineLimit) {
      finish(prepared.handoffText);
      return;
    }

    ACPBridge.saveConversationTranscript(conversationId, prepared.normalizedTranscript)
      .then((saved) => {
        finish(buildConversationHandoffFromTranscriptFile(prepared, saved.filePath || ''));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        finish(buildConversationHandoffSaveFailureContext(prepared, message));
      });
  }, [conversationId, messages, onForkRequest, selectedAgentId]);

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
            onForkFromMessage={handleForkFromMessage}
            scrollToBottomOnInitialMessages={Boolean(initialMessages?.length) && !historySession}
          />
        </div>
      </div>

      <div className="flex flex-col shrink-0 relative z-20 shadow-[0_-2px_8px_rgba(0,0,0,0.05)] bg-background">
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
            delay-150 ease-out group-hover:bg-[var(--ide-Button-default-focusColor)] group-hover:opacity-70" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-[2px]
            bg-[var(--ide-Borders-ContrastBorderColor)] rounded-full transition-[background-color,box-shadow]
            duration-500 delay-150 ease-out group-hover:bg-[var(--ide-Button-default-focusColor)] group-hover:opacity-70
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
            onAgentChange={handleAgentChange}
            
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
          onClick={closeSelectedImage}
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
                focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
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
                onClick={(e) => { e.stopPropagation(); closeSelectedImage(); }}
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


