import { useCallback, useState, useRef, useEffect } from 'react';
import { useChatSession } from '../../hooks/useChatSession';
import { useFileChanges } from '../../hooks/useFileChanges';
import { AgentOption, FileChangeSummary, HistorySessionMeta } from '../../types/chat';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import PermissionBar from './PermissionBar';
import FileChangesPanel from './FileChangesPanel';

interface ChatSessionProps {
  initialAgentId?: string;
  chatId: string;
  availableAgents: AgentOption[];
  historySession?: HistorySessionMeta;
  isActive?: boolean;
  onAssistantActivity?: (chatId: string) => void;
  onAtBottomChange?: (chatId: string, isAtBottom: boolean) => void;
  onPermissionRequestChange?: (chatId: string, hasPendingPermission: boolean) => void;
  onAgentChangeRequest?: (agentId: string) => void;
}

export default function ChatSessionView({ 
  initialAgentId, 
  chatId,
  availableAgents,
  historySession,
  isActive = false,
  onAssistantActivity,
  onAtBottomChange,
  onPermissionRequestChange,
  onAgentChangeRequest
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
    acpSessionId,
    adapterName,
    adapterDisplayName,
    adapterIconPath
  } = useChatSession(chatId, availableAgents, initialAgentId, historySession);

  const {
    hasPluginEdits,
    fileChanges,
    totalAdditions,
    totalDeletions,
    handleUndoFile,
    handleUndoAllFiles,
    handleKeepFile,
    handleKeepAll,
  } = useFileChanges(chatId, acpSessionId, adapterName);

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
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2000);
  };

  // --- Resizing Logic ---
  const INPUT_MIN_HEIGHT = 144;
  const INPUT_MIN_HEIGHT_WITH_ATTACHMENTS = 192;
  const INPUT_MAX_HEIGHT = 424;
  const INPUT_DEFAULT_HEIGHT = 180;
  const INPUT_BOTTOM_BAR_BUFFER = 86;
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
    onAtBottomChange?.(chatId, isAtBottom);
  }, [chatId, onAtBottomChange]);

  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    // Mark unread only when agent finishes the response, not during streaming/thinking.
    if (prev === 'ready' || status !== 'ready' || isHistoryReplaying || messages.length === 0 || !!permissionRequest) return;

    const last = messages[messages.length - 1];
    if (last.role !== 'assistant') return;
    const hasFinalText = (last.content?.trim().length || 0) > 0;
    if (!hasFinalText) return;

    onAssistantActivity?.(chatId);
  }, [status, isHistoryReplaying, messages, onAssistantActivity, chatId, permissionRequest]);

  useEffect(() => {
    onPermissionRequestChange?.(chatId, !!permissionRequest);
  }, [chatId, permissionRequest, onPermissionRequestChange]);

  useEffect(() => {
    return () => {
      onPermissionRequestChange?.(chatId, false);
    };
  }, [chatId, onPermissionRequestChange]);

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-background">
      {/* Message List Area with Scoped Overlay */}
      <div className="flex-1 flex flex-col min-h-0 relative">

        <div className={`flex-1 flex flex-col min-h-0`}>
          <MessageList 
            messages={messages} 
            onImageClick={setSelectedImage} 
            onAtBottomChange={handleAtBottomChange}
            isSending={isSending}
            status={status}
            agentName={adapterDisplayName}
            agentIconPath={adapterIconPath}
            isHistoryReplaying={isHistoryReplaying}
          />
        </div>
      </div>

      <div className="flex flex-col shrink-0 relative z-20 shadow-[0_-4px_15px_rgba(0,0,0,0.15)] bg-background">
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
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-border transition-colors group-hover:bg-accent" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-[2px] bg-border group-hover:bg-accent rounded-full transition-all" />
        </div>

        <div style={{ height: `${inputHeight}px` }} className="flex flex-col">
          <ChatInput
            chatId={chatId}
            inputValue={inputValue}
            onInputChange={setInputValue}
            onSend={handleSend}
            onStop={handleStop}
            isSending={isSending}
            
            agentOptions={agentOptions}
            selectedAgentId={selectedAgentId}
            onAgentChange={(id) => {
              if (onAgentChangeRequest && id !== selectedAgentId) {
                onAgentChangeRequest(id);
              }
            }}
            
            selectedModelId={selectedModelId}
            onModelChange={handleModelChange}
            
            modeOptions={modeOptions}
            selectedModeId={selectedModeId}
            onModeChange={handleModeChange}
            
            hasSelectedAgent={hasSelectedAgent}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onImageClick={setSelectedImage}
            onHeightChange={setContentHeight}
            customHeight={inputHeight}
            autoFocus={isActive}
          />
        </div>
      </div>

      {/* Full-size Image Overlay */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black bg-opacity-70 flex items-center 
            justify-center p-8 animate-in fade-in duration-200 cursor-zoom-out"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-full max-h-full flex items-center justify-center">
            <img 
              src={selectedImage} 
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-200" 
              alt="Full size preview"
            />
            <div className="absolute top-2 right-4 flex gap-2">
              <a 
                href={selectedImage}
                download="image.png"
                className="p-2 bg-black bg-opacity-50 hover:bg-opacity-80 rounded-full text-white 
                  transition-all outline-none shadow-xl"
                onClick={handleDownload}
                title="Download image"
              >
                {downloaded ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" 
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" 
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                )}
              </a>
              <button 
                className="p-2 bg-black bg-opacity-50 hover:bg-opacity-80 rounded-full text-white 
                  transition-all outline-none shadow-xl"
                onClick={(e) => { e.stopPropagation(); setSelectedImage(null); }}
                title="Close"
              >
                <svg 
                  xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" 
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
