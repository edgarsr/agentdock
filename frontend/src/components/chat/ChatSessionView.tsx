import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatSession, UseChatSessionOptions } from '../../hooks/useChatSession';
import { useFileChanges } from '../../hooks/useFileChanges';
import { FileChangeSummary, Message } from '../../types/chat';
import { acquireJcefLivePromptRepaint } from '../../utils/jcefHostRepaint';
import {
  buildConversationHandoffFromTranscriptFile,
  buildConversationHandoffSaveFailureContext,
  prepareConversationHandoff,
  prepareConversationHandoffWithInheritedContext,
} from '../../utils/conversationHandoff';
import { ACPBridge } from '../../utils/bridge';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { PromptQueueList } from './input/PromptQueueList';
import PermissionBar from './PermissionBar';
import FileChangesPanel from './FileChangesPanel';
import ConfirmationModal from '../ConfirmationModal';
import { ImageOverlayModal } from './shared/ImageOverlayModal';
import { useAgentHandoffRequest } from './session/useAgentHandoffRequest';
import { useChatInputResize } from './session/useChatInputResize';
import { useChatSessionNotifications } from './session/useChatSessionNotifications';

interface ChatSessionProps extends UseChatSessionOptions {
  isActive?: boolean;
  onAssistantActivity?: () => void;
  onAtBottomChange?: (isAtBottom: boolean) => void;
  onCanMarkReadChange?: (canMarkRead: boolean) => void;
  onPermissionRequestChange?: (hasPendingPermission: boolean) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  inheritedHandoffText?: string;
  onAgentChangeRequest?: (payload: { agentId: string; handoffText: string }) => void;
  onForkRequest?: (payload: { agentId: string; messages: Message[]; handoffText: string }) => void;
  onSessionStateChange?: (state: { acpSessionId: string; adapterName: string }) => void;
}

export default function ChatSessionView({ 
  initialAgentId, 
  conversationId,
  availableAgents,
  historySession,
  pendingHandoff,
  initialMessages,
  inheritedHandoffText,
  metadataTitleOverride,
  inheritedAdapterNames,
  forkBase,
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
    composerLoadRevision,
    status,
    isSending,
    isHistoryReplaying,
    queuedPrompts,
    removeQueuedPrompt,
    editQueuedPrompt,
    reorderQueuedPrompt,
    sendQueuedPromptNow,
    agentOptions,
    selectedAgentId,
    selectedModelId,
    handleModelChange,
    modeOptions,
    selectedModeId,
    handleModeChange,
    reasoningEffortOptions,
    selectedReasoningEffortId,
    handleReasoningEffortChange,
    additionalConfigOptions,
    handleConfigOptionChange,
    approvalMode,
    setApprovalMode,
    permissionRequest,
    handleSend,
    handleQueueDraft,
    handleStop,
    handlePermissionDecision,
    hasSelectedAgent,
    attachments,
    setAttachments,
    availableCommands,
    acpSessionId,
    adapterDisplayName,
    adapterIconPath
  } = useChatSession({
    conversationId,
    availableAgents,
    initialAgentId,
    historySession,
    pendingHandoff,
    initialMessages,
    metadataTitleOverride,
    inheritedAdapterNames,
    forkBase,
    onHandoffConsumed,
    onUserMessageSent
  });

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
  } = useFileChanges(conversationId, acpSessionId, selectedAgentId);

  const lastAssistantMsgWithContext = useMemo(() => {
    // Fork messages keep their original context metadata for transcript/history display,
    // but they belong to the source session and must not represent the new session usage.
    const currentSessionStartIndex = initialMessages?.length ?? 0;
    for (let i = messages.length - 1; i >= currentSessionStartIndex; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && (msg.contextTokensUsed !== undefined || msg.contextWindowSize !== undefined)) {
        if (!selectedAgentId || msg.agentId === selectedAgentId) {
          return msg;
        }
        return null; // The latest context is from a different agent, so wait for the current agent context.
      }
    }
    return null;
  }, [initialMessages?.length, messages, selectedAgentId]);

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
    isResizing,
    setContentHeight,
    startResizing,
  } = useChatInputResize(attachments);

  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const {
    handleAtBottomChange,
    handleCanMarkReadChange,
  } = useChatSessionNotifications({
    messages,
    isSending,
    isHistoryReplaying,
    permissionRequest,
    conversationId,
    acpSessionId,
    adapterName: selectedAgentId,
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
    const initialMessageCount = initialMessages?.length ?? 0;
    const continuesForkedSession = Boolean(inheritedHandoffText) && endExclusive > initialMessageCount;
    const prepared = continuesForkedSession
      ? prepareConversationHandoffWithInheritedContext(
        forkMessages.slice(initialMessageCount),
        inheritedHandoffText || '',
      )
      : prepareConversationHandoff(forkMessages);

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
  }, [conversationId, inheritedHandoffText, initialMessages?.length, messages, onForkRequest, selectedAgentId]);

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-background">
          <MessageList 
            messages={messages} 
            onImageClick={setPreviewImage} 
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
            footer={<>
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

        {queuedPrompts.length > 0 && (
          <PromptQueueList
            items={queuedPrompts}
            onRemove={removeQueuedPrompt}
            onEdit={editQueuedPrompt}
            onReorder={reorderQueuedPrompt}
            onSendNow={sendQueuedPromptNow}
            sendNowCancelsCurrent={status === 'prompting' && isSending}
          />
        )}

        <div style={{ height: `${inputHeight}px` }} className="flex flex-col">
          <ChatInput
            onResizeStart={startResizing}
            isResizing={isResizing}
            conversationId={conversationId}
            contextTokensUsed={lastAssistantMsgWithContext?.contextTokensUsed}
            contextWindowSize={lastAssistantMsgWithContext?.contextWindowSize}
            inputValue={inputValue}
            composerLoadRevision={composerLoadRevision}
            onInputChange={setInputValue}
            onSend={handleSend}
            onQueueDraft={handleQueueDraft}
            onStop={handleStop}
            isSending={isSending}
            promptQueueEnabled
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

            reasoningEffortOptions={reasoningEffortOptions}
            selectedReasoningEffortId={selectedReasoningEffortId}
            onReasoningEffortChange={handleReasoningEffortChange}
            additionalConfigOptions={additionalConfigOptions}
            onConfigOptionChange={handleConfigOptionChange}

            approvalMode={approvalMode}
            onApprovalModeChange={setApprovalMode}
            
            hasSelectedAgent={hasSelectedAgent}
            availableCommands={availableCommands}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onImageClick={setPreviewImage}
            onHeightChange={setContentHeight}
            customHeight={inputHeight}
            autoFocus={isActive}
            isActive={isActive}
          />
        </div>
        <div aria-hidden="true" className="h-2 shrink-0" />
            </>}
          />

      {/* Full-size Image Overlay */}
      <ImageOverlayModal src={previewImage} onClose={() => setPreviewImage(null)} />

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
