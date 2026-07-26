import AttachmentBar from './input/AttachmentBar';
import SlashCommandMenu from './input/SlashCommandMenu';
import FileMentionMenu from './input/FileMentionMenu';
import { ChatInputControls } from './input/ChatInputControls';
import { ChatInputEditor } from './input/ChatInputEditor';
import { ChatInputProps } from './input/chatInputState';
import { useChatInputController } from './input/useChatInputController';

export default function ChatInput(props: ChatInputProps) {
  const {
    conversationId,
    contextTokensUsed,
    contextWindowSize,
    inputValue,
    onInputChange,
    onSend,
    onQueueDraft,
    onStop,
    isSending,
    promptQueueEnabled,
    agentOptions,
    selectedAgentId,
    onAgentChange,
    selectedModelId,
    onModelChange,
    usageSessionKey,
    status,
    modeOptions,
    selectedModeId,
    onModeChange,
    reasoningEffortOptions,
    selectedReasoningEffortId,
    onReasoningEffortChange,
    additionalConfigOptions,
    onConfigOptionChange,
    approvalMode,
    onApprovalModeChange,
    hasSelectedAgent,
    attachments,
    onAttachmentsChange,
    onImageClick,
    onHeightChange,
    isActive = false
  } = props;

  const {
    editorContainerRef,
    inputRootRef,
    controlsRowRef,
    slashMenuRef,
    fileMenuRef,
    composerRevision,
    initialConfig,
    sendMode,
    setSendMode,
    plusMenuOptions,
    isDragOver,
    isSlashMenuOpen,
    slashCommands,
    slashMenuLayout,
    highlightedIndex,
    setHighlightedIndex,
    applyCommand,
    isFileMenuOpen,
    mentionedFiles,
    fileMenuLayout,
    fileHighlightedIndex,
    setFileHighlightedIndex,
    applyFile,
    customHeight,
    collapsedAgentDropdown,
    showAuxIndicators,
    showVoiceButton,
    isTranscribing,
    isRecording,
    agentSlashItems,
    promptLibrarySlashItems,
    handleOpenFile,
    handleImagePaste,
    combinedHandleKeyDownCapture,
    handleInsertSlashItem,
    handleVoiceInput,
    setLexicalEditor,
  } = useChatInputController(props);

  const handleSubmit = isSending ? (() => onQueueDraft?.()) : onSend;

  return (
    <div ref={inputRootRef} style={{ height: customHeight ? `${customHeight}px` : undefined }} className="relative flex-shrink-0 px-4 pb-2 pt-2">
      <div className="mx-auto h-full w-full max-w-[1200px] flex flex-col">
        <div className="relative flex h-full flex-col rounded-ide border border-[var(--ide-Button-startBorderColor)]
          bg-editor-bg transition-all focus-within:ring-1 focus-within:[--tw-ring-color:color-mix(in_srgb,var(--ide-Button-default-focusColor)_70%,transparent)]">

          <AttachmentBar
            attachments={attachments}
            onRemove={(id) => onAttachmentsChange(attachments.filter(a => a.id !== id))}
            onImageClick={onImageClick}
          />

          <ChatInputEditor
            conversationId={conversationId}
            composerRevision={composerRevision}
            initialConfig={initialConfig}
            editorContainerRef={editorContainerRef}
            inputValue={inputValue}
            attachments={attachments}
            sendMode={sendMode}
            isActive={isActive}
            isDragOver={isDragOver}
            isSlashMenuOpen={isSlashMenuOpen}
            onInputChange={onInputChange}
            onAttachmentsChange={onAttachmentsChange}
            onImageClick={onImageClick}
            onOpenFile={handleOpenFile}
            onHeightChange={onHeightChange}
            onImagePaste={handleImagePaste}
            onSend={handleSubmit}
            onKeyDownCapture={combinedHandleKeyDownCapture}
            onEditorReady={setLexicalEditor}
          />

          <ChatInputControls
            controlsRowRef={controlsRowRef}
            sendMode={sendMode}
            setSendMode={setSendMode}
            plusMenuOptions={plusMenuOptions}
            conversationId={conversationId}
            agentOptions={agentOptions}
            selectedAgentId={selectedAgentId}
            selectedModelId={selectedModelId}
            selectedModeId={selectedModeId}
            modeOptions={modeOptions}
            selectedReasoningEffortId={selectedReasoningEffortId}
            reasoningEffortOptions={reasoningEffortOptions}
            additionalConfigOptions={additionalConfigOptions}
            approvalMode={approvalMode}
            isSending={isSending}
            hasSelectedAgent={hasSelectedAgent}
            status={status}
            usageSessionKey={usageSessionKey}
            contextTokensUsed={contextTokensUsed}
            contextWindowSize={contextWindowSize}
            inputValue={inputValue}
            collapsedAgentDropdown={collapsedAgentDropdown}
            showAuxIndicators={showAuxIndicators}
            showVoiceButton={showVoiceButton}
            isTranscribing={isTranscribing}
            isRecording={isRecording}
            agentSlashItems={agentSlashItems}
            promptLibrarySlashItems={promptLibrarySlashItems}
            handleInsertSlashItem={handleInsertSlashItem}
            handleVoiceInput={handleVoiceInput}
            onAgentChange={onAgentChange}
            onModelChange={onModelChange}
            onModeChange={onModeChange}
            onReasoningEffortChange={onReasoningEffortChange}
            onConfigOptionChange={onConfigOptionChange}
            onApprovalModeChange={onApprovalModeChange}
            onSend={onSend}
            onQueueDraft={onQueueDraft}
            onStop={onStop}
            promptQueueEnabled={promptQueueEnabled}
          />
        </div>
      </div>
      {isSlashMenuOpen && slashMenuLayout && (
        <SlashCommandMenu
          commands={slashCommands}
          highlightedIndex={highlightedIndex}
          layout={slashMenuLayout}
          menuRef={slashMenuRef}
          onHover={setHighlightedIndex}
          onSelect={applyCommand}
        />
      )}
      {isFileMenuOpen && fileMenuLayout && (
        <FileMentionMenu
          files={mentionedFiles}
          highlightedIndex={fileHighlightedIndex}
          layout={fileMenuLayout}
          menuRef={fileMenuRef}
          onHover={setFileHighlightedIndex}
          onSelect={applyFile}
        />
      )}
    </div>
  );
}
