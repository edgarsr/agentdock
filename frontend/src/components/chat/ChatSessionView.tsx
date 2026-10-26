import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatSession, UseChatSessionOptions } from '../../hooks/useChatSession';
import { useFileChanges } from '../../hooks/useFileChanges';
import { isShortcut, useKeyDown } from '../../hooks/useShortcuts';
import { FileChangeSummary, Message, UndoFileResultPayload } from '../../types/chat';
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
import { ScheduleBar } from './input/ScheduleBar';
import { PromptQueueList } from './input/PromptQueueList';
import PermissionBar from './PermissionBar';
import { ElicitationForm } from './ElicitationForm';
import FileChangesPanel from './FileChangesPanel';
import ConfirmationModal from '../ConfirmationModal';
import { ImageOverlayModal } from './shared/ImageOverlayModal';
import { useAgentHandoffRequest } from './session/useAgentHandoffRequest';
import { useChatInputResize } from './session/useChatInputResize';
import { useChatSessionNotifications } from './session/useChatSessionNotifications';

interface ChatSessionProps extends UseChatSessionOptions {
  isActive?: boolean;
  promptNavigationHoverOnly: boolean;
  onAssistantActivity?: () => void;
  onCanMarkReadChange?: (canMarkRead: boolean) => void;
  onPermissionRequestChange?: (hasPendingPermission: boolean) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  onQueuedChange?: (hasQueuedPrompts: boolean) => void;
  inheritedHandoffText?: string;
  onAgentChangeRequest?: (payload: { agentId: string; handoffText: string }) => void;
  onForkRequest?: (payload: { agentId: string; messages: Message[]; handoffText: string }) => void;
  onSessionStateChange?: (state: { acpSessionId: string; adapterName: string }) => void;
}

function UndoFailureDetails({
  failures,
  hadSuccess,
  onOpenFile,
}: {
  failures: UndoFileResultPayload[];
  hadSuccess: boolean;
  onOpenFile: (filePath: string) => void;
}) {
  const fileName = (path: string) => path.replace(/\\/g, '/').split('/').pop() || path;
  const nameCounts = new Map<string, number>();
  for (const failure of failures) {
    const name = fileName(failure.filePath);
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  const label = (path: string) => {
    const name = fileName(path);
    return nameCounts.get(name) === 1 ? name : path.replace(/\\/g, '/');
  };
  const groups = [
    {
      heading: 'Could not undo the following files due to edit conflicts:',
      files: failures.filter((failure) => failure.reason === 'conflict'),
      showReason: false,
    },
    {
      heading: 'Could not undo the following files:',
      files: failures.filter((failure) => failure.reason !== 'conflict'),
      showReason: true,
    },
  ];

  return (
    <div className="space-y-3">
      {groups.filter((group) => group.files.length > 0).map((group) => (
        <div key={group.heading}>
          <div>{group.heading}</div>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {group.files.map((failure) => (
              <li key={failure.filePath}>
                <button
                  type="button"
                  className="rounded-[4px] text-link text-left underline focus-visible:outline focus-visible:outline-[var(--ide-Button-default-focusColor)]"
                  onClick={() => onOpenFile(failure.filePath)}
                >
                  {label(failure.filePath)}
                </button>
                {group.showReason && `: ${failure.message}`}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {hadSuccess && <div>The other files were undone successfully.</div>}
    </div>
  );
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
  restored,
  isActive = false,
  promptNavigationHoverOnly,
  onUserMessageSent,
  onAssistantActivity,
  onCanMarkReadChange,
  onPermissionRequestChange,
  onProcessingChange,
  onQueuedChange,
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
    scheduleEnabled,
    setScheduleMode,
    scheduledAt,
    setScheduledAt,
    scheduleDraftRevision,
    queueError,
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
    elicitationRequest,
    handleSend,
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
    restored,
    onHandoffConsumed,
    onUserMessageSent
  });

  useEffect(() => {
    onQueuedChange?.(queuedPrompts.length > 0);
  }, [onQueuedChange, queuedPrompts.length]);

  const {
    hasPluginEdits,
    fileChanges,
    totalAdditions,
    totalDeletions,
    undoError,
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
    handleCanMarkReadChange,
  } = useChatSessionNotifications({
    messages,
    isSending,
    isHistoryReplaying,
    hasPendingRequest: !!permissionRequest || !!elicitationRequest,
    conversationId,
    acpSessionId,
    adapterName: selectedAgentId,
    onAssistantActivity,
    onCanMarkReadChange,
    onPermissionRequestChange,
    onProcessingChange,
    onSessionStateChange,
  });

  useEffect(() => {
    if (!isActive || isHistoryReplaying || status !== 'prompting') return;
    return acquireJcefLivePromptRepaint();
  }, [isActive, isHistoryReplaying, status]);

  useKeyDown((event) => {
    if (!isSending || !isShortcut(event, 'cancelPrompt')) return false;
    handleStop();
    return true;
  }, isActive);

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
            promptNavigationHoverOnly={promptNavigationHoverOnly}
            onImageClick={setPreviewImage} 
            onCanMarkReadChange={handleCanMarkReadChange}
            isSending={isSending}
            status={status}
            agentName={adapterDisplayName}
            agentIconPath={adapterIconPath}
            availableAgents={availableAgents}
            isHistoryReplaying={isHistoryReplaying}
            onForkFromMessage={handleForkFromMessage}
            scrollToBottomOnInitialMessages={Boolean(initialMessages?.length) && !historySession}
            isActive={isActive}
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

        {elicitationRequest && <ElicitationForm key={elicitationRequest.requestId} request={elicitationRequest} />}

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

        {scheduleEnabled && (
          <ScheduleBar
            key={`${composerLoadRevision}-${scheduleDraftRevision}`}
            scheduledAt={scheduledAt}
            onScheduledAtChange={setScheduledAt}
            onClose={() => setScheduleMode(false)}
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
            scheduleEnabled={scheduleEnabled}
            onScheduleModeChange={setScheduleMode}
            queueError={queueError}
            onStop={handleStop}
            isSending={isSending}

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
            </>}
          />

      {/* Full-size Image Overlay */}
      <ImageOverlayModal src={previewImage} onClose={() => setPreviewImage(null)} />

      <ConfirmationModal
        isOpen={undoError !== null}
        title="Undo failed"
        message={undoError && 'failures' in undoError
          ? <UndoFailureDetails
              failures={undoError.failures}
              hadSuccess={undoError.hadSuccess}
              onOpenFile={(filePath) => {
                clearUndoError();
                handleOpenFile(filePath);
              }}
            />
          : undoError && 'message' in undoError ? undoError.message : ''}
        confirmLabel="OK"
        showCancelButton={false}
        onConfirm={clearUndoError}
        onCancel={clearUndoError}
      />
    </div>
  );
}
