import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  LexicalEditor,
} from 'lexical';
import {
  Bookmark,
  CornerDownLeft,
  Keyboard as KeyboardIcon,
  LoaderCircle,
  Mic,
  Paperclip,
  SendHorizontal,
  SquareTerminal,
} from 'lucide-react';

import ChatDropdown from './ChatDropdown';
import {
  AudioRecordingStatePayload,
  AudioTranscriptionFeatureState,
  AvailableCommand,
  ChatAttachment,
  DropdownOption,
} from '../../types/chat';
import { PromptLibraryItem } from '../../types/promptLibrary';
import AttachmentBar from './input/AttachmentBar';
import { ACPBridge } from '../../utils/bridge';
import { openFile } from '../../utils/openFile';
import { ChatUsageIndicator } from '../usage/chat/ChatUsageIndicator';
import SlashCommandMenu from './input/SlashCommandMenu';
import { useSlashCommands } from '../../hooks/useSlashCommands';
import {
  applySlashCommandToEditor,
  buildAgentSlashItems,
  buildPromptLibrarySlashItems,
} from './input/slashCommands';
import FileMentionMenu from './input/FileMentionMenu';
import { useFileMentions } from '../../hooks/useFileMentions';

import { ChatInputActionsContext } from './input/ChatInputActionsContext';
import { ImageNode, $createImageNode } from './input/ImageNode';
import { CodeReferenceNode } from './input/CodeReferenceNode';
import {
  AttachmentsSyncPlugin,
  PasteLogPlugin,
  KeyboardPlugin,
  AutoHeightPlugin,
  ClickToFocusPlugin,
  ClearEditorPlugin,
  InlineAttachmentBackspacePlugin,
  ExternalCodeReferencePlugin,
  RegisterEditorPlugin,
  PlainTextFormattingGuardPlugin,
} from './input/ChatInputPlugins';
import { ContextUsageIndicator } from './shared/ContextUsageIndicator';
import { Tooltip } from './shared/Tooltip';
import { AdapterUsageLifecycleProvider } from '../../hooks/useAdapterUsage';

interface ChatInputProps {
  conversationId: string;
  contextTokensUsed?: number;
  contextWindowSize?: number;
  inputValue: string;
  onInputChange: (val: string) => void;
  onSend: () => void;
  onStop: () => void;
  isSending: boolean;
  agentOptions: DropdownOption[];
  selectedAgentId: string;
  onAgentChange: (id: string) => void;
  selectedModelId: string;
  onModelChange: (id: string, targetAgentId?: string) => void;
  usageSessionKey?: string;
  status: string;
  modeOptions: DropdownOption[];
  selectedModeId: string;
  onModeChange: (id: string) => void;
  hasSelectedAgent: boolean;
  availableCommands: AvailableCommand[];
  attachments: ChatAttachment[];
  onAttachmentsChange: (items: ChatAttachment[]) => void;
  onImageClick: (src: string) => void;
  onHeightChange?: (contentHeight: number) => void;
  customHeight?: number;
  autoFocus?: boolean;
  isActive?: boolean;
}

const emptyTranscriptionFeature: AudioTranscriptionFeatureState = {
  id: 'whisper-transcription',
  title: 'Whisper',
  installed: false,
  installing: false,
  supported: false,
  status: 'Loading',
  detail: '',
  installPath: '',
};

export default function ChatInput({
  conversationId,
  contextTokensUsed,
  contextWindowSize,
  inputValue,
  onInputChange,
  onSend,
  onStop,
  isSending,
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
  hasSelectedAgent,
  availableCommands,
  attachments,
  onAttachmentsChange,
  onImageClick,
  onHeightChange,
  customHeight = 180,
  autoFocus = false,
  isActive = false
}: ChatInputProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const inputRootRef = useRef<HTMLDivElement>(null);
  const controlsRowRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const transcriptionRequestCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [promptLibraryItems, setPromptLibraryItems] = useState<PromptLibraryItem[]>([]);
  const [transcriptionFeature, setTranscriptionFeature] = useState<AudioTranscriptionFeatureState>(emptyTranscriptionFeature);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [composerRevision, setComposerRevision] = useState(0);
  const registeredNodeClassesRef = useRef({
    imageNode: ImageNode,
    codeReferenceNode: CodeReferenceNode,
  });

  useEffect(() => {
    const cleanup = ACPBridge.onPromptLibrary((e) => setPromptLibraryItems(e.detail.items));
    ACPBridge.loadPromptLibrary();
    return cleanup;
  }, []);

  useEffect(() => {
    const previous = registeredNodeClassesRef.current;
    if (previous.imageNode !== ImageNode || previous.codeReferenceNode !== CodeReferenceNode) {
      registeredNodeClassesRef.current = {
        imageNode: ImageNode,
        codeReferenceNode: CodeReferenceNode,
      };
      lexicalEditorRef.current = null;
      setComposerRevision((value) => value + 1);
    }
  }, [ImageNode, CodeReferenceNode]);

  useEffect(() => {
    const cleanup = ACPBridge.onAudioTranscriptionFeature((e) => setTranscriptionFeature(e.detail.state));
    ACPBridge.loadAudioTranscriptionFeature();
    return cleanup;
  }, []);

  useEffect(() => {
    const cleanup = ACPBridge.onAudioRecordingState((e) => {
      const payload: AudioRecordingStatePayload = e.detail.payload;
      setIsRecording(payload.recording);
      if (payload.error) {
        console.error('[ChatInput] Audio recording error:', payload.error);
      }
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const handleDragHighlight = (e: Event) => {
      const active = (e as CustomEvent<{ active: boolean }>).detail?.active;
      setIsDragOver(!!active);
    };
    window.addEventListener('drag-highlight', handleDragHighlight as EventListener);
    return () => window.removeEventListener('drag-highlight', handleDragHighlight as EventListener);
  }, []);

  useEffect(() => {
    const updateWidths = () => {
      setContainerWidth(inputRootRef.current?.clientWidth ?? 0);
    };

    updateWidths();
    const raf = requestAnimationFrame(updateWidths);
    window.addEventListener('resize', updateWidths);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateWidths);
    };
  }, [selectedAgentId, selectedModelId, selectedModeId, modeOptions.length, status, isSending]);

  const handleOpenFile = useCallback((filePath: string, line?: number) => {
    openFile(filePath, line);
  }, []);

  const [sendMode, setSendMode] = useState<'enter' | 'ctrl-enter'>(() => {
    return (localStorage.getItem('chat-send-mode') as 'enter' | 'ctrl-enter') || 'enter';
  });



  const initialConfig = useMemo(() => ({
    namespace: `ChatInput-${conversationId}`,
    nodes: [ImageNode, CodeReferenceNode],
    theme: {
      paragraph: 'm-0',
      text: { base: 'text-foreground' },
    },
    onError: (error: Error) => console.error(error),
  }), [conversationId, composerRevision]);

  const agentSlashItems = useMemo(
    () => buildAgentSlashItems(availableCommands),
    [availableCommands]
  );

  const promptLibrarySlashItems = useMemo(
    () => buildPromptLibrarySlashItems(promptLibraryItems),
    [promptLibraryItems]
  );

  const slashItems = useMemo(() => ([
    ...agentSlashItems,
    ...promptLibrarySlashItems,
  ]), [agentSlashItems, promptLibrarySlashItems]);

  const sendModeIcon = useMemo(() => (
    sendMode === 'ctrl-enter'
      ? <KeyboardIcon className="w-4 h-4" />
      : <CornerDownLeft className="w-4 h-4" />
  ), [sendMode]);

  const plusMenuOptions: DropdownOption[] = useMemo(() => {
    const options: DropdownOption[] = [
      { id: 'add-files', label: 'Attach file', icon: <Paperclip className="w-4 h-4" /> },
    ];

    if (agentSlashItems.length > 0) {
      options.push({
        id: 'commands',
        label: 'Insert command',
        icon: <SquareTerminal className="w-4 h-4" />,
        subOptions: agentSlashItems.map((command) => ({
          id: command.id,
          label: `${command.displayPrefix}${command.name}`,
          description: command.description,
        })),
      });
    }

    if (promptLibrarySlashItems.length > 0) {
      options.push({
        id: 'prompt-library',
        label: 'Insert prompt',
        icon: <Bookmark className="w-4 h-4" />,
        subOptions: promptLibrarySlashItems.map((prompt) => ({
          id: prompt.id,
          label: prompt.name,
          description: prompt.description,
        })),
      });
    }

    options.push({
      id: 'send-mode',
      label: 'Send mode',
      icon: sendModeIcon,
      subOptions: [
        { id: 'enter', label: 'Enter', icon: <CornerDownLeft className="w-4 h-4" /> },
        { id: 'ctrl-enter', label: 'Ctrl+Enter', icon: <KeyboardIcon className="w-4 h-4" /> },
      ]
    });

    return options;
  }, [agentSlashItems, promptLibrarySlashItems, sendModeIcon]);

  const handleImagePaste = useCallback((file: File, editor: LexicalEditor) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      const id = Math.random().toString(36).substring(2, 9);
      const newAtt = { id, name: file.name || 'pasted-image.png', data: base64, mimeType: file.type, isInline: true };
      onAttachmentsChange([...attachments, newAtt]);

      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const imageNode = $createImageNode(id);
          selection.insertNodes([imageNode]);
        }
      });
    };
    reader.readAsDataURL(file);
  }, [attachments, onAttachmentsChange]);

  useEffect(() => {
    if (!autoFocus) return;
    const focusEditor = () => {
      const editable = editorContainerRef.current?.querySelector('[contenteditable="true"]') as HTMLElement | null;
      if (editable) {
        editable.focus();
      }
    };
    const raf = requestAnimationFrame(focusEditor);
    return () => cancelAnimationFrame(raf);
  }, [autoFocus, conversationId]);

  const {
    commands: slashCommands,
    isOpen: isSlashMenuOpen,
    layout: slashMenuLayout,
    highlightedIndex,
    setHighlightedIndex,
    applyCommand,
    handleKeyDownCapture,
  } = useSlashCommands({
    inputValue,
    selectedAgentId,
    availableCommands: slashItems,
    inputRootRef,
    menuRef: slashMenuRef,
    lexicalEditorRef,
    onInputChange,
  });

  const {
    files: mentionedFiles,
    isOpen: isFileMenuOpen,
    layout: fileMenuLayout,
    highlightedIndex: fileHighlightedIndex,
    setHighlightedIndex: setFileHighlightedIndex,
    applyFile,
    handleKeyDownCapture: handleFileMentionsKeyDownCapture,
  } = useFileMentions({
    inputRootRef,
    menuRef: fileMenuRef,
    lexicalEditorRef,
  });

  const combinedHandleKeyDownCapture = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
     if (isFileMenuOpen) {
       handleFileMentionsKeyDownCapture(e);
       if (e.defaultPrevented) return;
     }
     if (isSlashMenuOpen) {
       handleKeyDownCapture(e);
       if (e.defaultPrevented) return;
     }
  }, [handleFileMentionsKeyDownCapture, handleKeyDownCapture, isFileMenuOpen, isSlashMenuOpen]);

  const insertTranscript = useCallback((text: string) => {
    const normalizedText = text.trim();
    if (!normalizedText) return;

    const editor = lexicalEditorRef.current;
    if (!editor) {
      const fallback = inputValue.trim() ? `${inputValue.trimEnd()} ${normalizedText}` : normalizedText;
      onInputChange(fallback);
      return;
    }

    let nextText = normalizedText;
    editor.update(() => {
      const root = $getRoot();
      const existingText = root.getTextContent();
      const prefix = existingText.trim().length > 0 && !existingText.endsWith(' ') && !existingText.endsWith('\n') ? ' ' : '';
      root.selectEnd();
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertText(`${prefix}${normalizedText}`);
      }
      nextText = root.getTextContent();
    });
    onInputChange(nextText);
  }, [inputValue, onInputChange]);

  const handleInsertSlashItem = useCallback((itemId: string, items: typeof slashItems) => {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;

    applySlashCommandToEditor(
      lexicalEditorRef.current,
      item,
      onInputChange
    );
  }, [lexicalEditorRef, onInputChange]);

  const handleVoiceInput = useCallback(async () => {
    if (isTranscribing) return;

    if (isRecording) {
      setIsTranscribing(true);
      try {
        transcriptionRequestCounterRef.current += 1;
        const requestId = `audio-recording-${conversationId}-${transcriptionRequestCounterRef.current}-${Date.now()}`;
        const result = await ACPBridge.stopAudioRecording(requestId);
        insertTranscript(result.text || '');
      } catch (error) {
        console.error('[ChatInput] Voice transcription failed:', error);
      } finally {
        setIsRecording(false);
        setIsTranscribing(false);
      }
      return;
    }

    try {
      ACPBridge.startAudioRecording();
      setIsRecording(true);
    } catch (error) {
      console.error('[ChatInput] Unable to start audio capture:', error);
      setIsRecording(false);
    }
  }, [conversationId, insertTranscript, isRecording, isTranscribing]);

  const showVoiceButton = transcriptionFeature.installed;
  const collapsedAgentDropdown = containerWidth > 0 && containerWidth < 400;
  const showAuxIndicators = containerWidth === 0 || containerWidth >= 320;

  return (
    <div ref={inputRootRef} style={{ height: customHeight ? `${customHeight}px` : undefined }} className="relative flex-shrink-0 px-4 pb-2 pt-2">
      <div className="mx-auto h-full w-full max-w-[1200px] flex flex-col">
        <div className="relative flex h-full flex-col rounded-ide border border-[var(--ide-Button-startBorderColor)]
          bg-editor-bg transition-all focus-within:ring-1 focus-within:ring-accent/50">

          <AttachmentBar
            attachments={attachments}
            onRemove={(id) => onAttachmentsChange(attachments.filter(a => a.id !== id))}
            onImageClick={onImageClick}
          />

          <div
            ref={editorContainerRef}
            onKeyDownCapture={combinedHandleKeyDownCapture}
            className={`relative flex min-h-0 flex-1 cursor-text flex-col overflow-y-auto rounded-t-ide transition-colors 
              ${isDragOver ? 'bg-accent/5 ring-2 ring-inset ring-accent/50' : ''}`}
          >
            <ChatInputActionsContext.Provider value={{ onImageClick, onOpenFile: handleOpenFile, attachments }}>
              <LexicalComposer key={`chat-input-${conversationId}-${composerRevision}`} initialConfig={initialConfig}>
                <RichTextPlugin
                  contentEditable={
                    <ContentEditable
                      className="outline-none p-3 text-foreground placeholder:text-foreground"
                      spellCheck={false}
                    />
                  }
                  placeholder={
                    <div className="absolute top-3 left-3 text-foreground-secondary pointer-events-none">
                      Type your task here, @ to add files, / for commands
                    </div>
                  }
                  ErrorBoundary={LexicalErrorBoundary}
                />
                <HistoryPlugin />
                <RegisterEditorPlugin onReady={(editor) => {
                  lexicalEditorRef.current = editor;
                }} />
                <OnChangePlugin onChange={(editorState) => {
                  editorState.read(() => {
                    const text = $getRoot().getTextContent();
                    if (text !== inputValue) onInputChange(text);
                  });
                }} />
                <ClearEditorPlugin inputValue={inputValue} />
                <AttachmentsSyncPlugin attachments={attachments} onAttachmentsChange={onAttachmentsChange} />
                <PasteLogPlugin onImagePaste={handleImagePaste} />
                <KeyboardPlugin onSend={onSend} sendMode={sendMode} disabled={isSlashMenuOpen} />
                <PlainTextFormattingGuardPlugin />
                <InlineAttachmentBackspacePlugin />
                <ExternalCodeReferencePlugin
                  isActive={isActive}
                  attachments={attachments}
                  onAttachmentsChange={onAttachmentsChange}
                />
                {onHeightChange && <AutoHeightPlugin onHeightChange={onHeightChange} />}
                <ClickToFocusPlugin containerRef={editorContainerRef} />
              </LexicalComposer>
            </ChatInputActionsContext.Provider>
          </div>

          <div ref={controlsRowRef} className="flex flex-wrap items-stretch gap-y-1 px-1 py-1 text-foreground">
            <div className="flex min-w-0 flex-1 items-stretch">
              <ChatDropdown
                value="send-mode"
                subValue={sendMode}
                options={plusMenuOptions}
                placeholder=""
                disabled={false}
                direction="up"
                customTrigger={
                  <div className="flex items-center text-ide-small">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
                  </div>
                }
                onChange={(id) => {
                  if (id === 'add-files') {
                    if (typeof window.__attachFile === 'function') {
                      window.__attachFile(conversationId);
                    }
                  }
                }}
                onSubChange={(parentId, subId) => {
                  if (parentId === 'send-mode') {
                    setSendMode(subId as 'enter' | 'ctrl-enter');
                    localStorage.setItem('chat-send-mode', subId);
                    return;
                  }

                  if (parentId === 'commands') {
                    handleInsertSlashItem(subId, agentSlashItems);
                    return;
                  }

                  if (parentId === 'prompt-library') {
                    handleInsertSlashItem(subId, promptLibrarySlashItems);
                  }
                }}
              />

              <ChatDropdown
                value={selectedAgentId}
                subValue={selectedModelId}
                options={agentOptions}
                placeholder="Select Agent"
                disabled={isSending}
                collapsed={collapsedAgentDropdown}
                showSubValueInTrigger={true}
                onChange={onAgentChange}
                onSubChange={(_agentId, modelId) => {
                  onModelChange(modelId, _agentId);
                }}
                className="ml-0.5"
              />

              {modeOptions.length > 0 && (
                <ChatDropdown
                  value={selectedModeId}
                  options={modeOptions}
                  placeholder="Mode"
                  disabled={isSending || !hasSelectedAgent}
                  onChange={onModeChange}
                  className="ml-0.5"
                />
              )}

              {showAuxIndicators && selectedAgentId && (
                <AdapterUsageLifecycleProvider
                  value={{
                    enabled: true,
                    isSending,
                    sessionKey: status === 'ready' ? usageSessionKey : undefined,
                  }}
                >
                  <ChatUsageIndicator agentId={selectedAgentId} modelId={selectedModelId} />
                </AdapterUsageLifecycleProvider>
              )}

              {showAuxIndicators && <ContextUsageIndicator used={contextTokensUsed} size={contextWindowSize} />}
            </div>

            <div className="ml-auto flex shrink-0 items-stretch">
              {showVoiceButton && (
                isTranscribing ? (
                  <button
                    type="button"
                    disabled={true}
                    className="flex items-center h-full px-1.5 rounded appearance-none border-0 bg-editor-bg outline-none text-ide-small text-foreground opacity-50 focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  >
                    <LoaderCircle size={16} className="animate-spin" />
                    <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleVoiceInput}
                    disabled={isSending}
                    className={`flex items-center h-full px-1.5 rounded appearance-none border-0 outline-none text-ide-small focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] ${
                      isRecording
                        ? 'bg-[#db5c5c] text-foreground'
                        : 'bg-editor-bg text-foreground hover:text-foreground hover:bg-hover focus-visible:bg-hover focus-visible:text-foreground'
                    }`}
                  >
                    <Tooltip variant="minimal" content={isRecording ? 'Stop recording' : 'Voice input'}>
                      <div className="flex items-center">
                        <Mic size={16} className="block translate-y-px" />
                        <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
                      </div>
                    </Tooltip>
                  </button>
                )
              )}

              {isSending ? (
                  <button
                    type="button"
                    onClick={onStop}
                    className="flex items-center h-full px-1.5 rounded appearance-none border-0 bg-editor-bg
                        outline-none text-ide-small text-error hover:bg-hover focus-visible:bg-hover
                        focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  >
                    <Tooltip variant="minimal" content="Cancel">
                      <div className="flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        </svg>
                        <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
                      </div>
                    </Tooltip>
                  </button>
              ) : (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!inputValue.trim()}
                  className={`flex items-center h-full px-1.5 rounded appearance-none border-0 bg-editor-bg outline-none 
                    text-ide-small focus-visible:bg-hover focus-visible:text-foreground 
                    focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] 
                    hover:bg-hover disabled:pointer-events-none text-foreground-secondary
                    hover:text-foreground ${!inputValue.trim() ? 'opacity-30' : ''}`}
                >
                  <Tooltip variant="minimal" content={inputValue.trim() ? "Send" : null}>
                    <div className="flex items-center">
                      <SendHorizontal size={16} className="block" strokeWidth={2} />
                      <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
                    </div>
                  </Tooltip>
                </button>
              )}
            </div>
          </div>
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
