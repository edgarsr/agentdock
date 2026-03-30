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
import { LoaderCircle, Mic, Square } from 'lucide-react';

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
import { Tooltip } from './shared/Tooltip';
import { ACPBridge } from '../../utils/bridge';
import { openFile } from '../../utils/openFile';
import { ChatUsageIndicator } from '../usage/chat/ChatUsageIndicator';
import SlashCommandMenu from './input/SlashCommandMenu';
import { useSlashCommands } from '../../hooks/useSlashCommands';
import { buildAgentSlashItems, buildPromptLibrarySlashItems } from './input/slashCommands';
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
} from './input/ChatInputPlugins';
import { ContextUsageIndicator } from './shared/ContextUsageIndicator';
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
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const transcriptionRequestCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [promptLibraryItems, setPromptLibraryItems] = useState<PromptLibraryItem[]>([]);
  const [transcriptionFeature, setTranscriptionFeature] = useState<AudioTranscriptionFeatureState>(emptyTranscriptionFeature);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  useEffect(() => {
    const cleanup = ACPBridge.onPromptLibrary((e) => setPromptLibraryItems(e.detail.items));
    ACPBridge.loadPromptLibrary();
    return cleanup;
  }, []);

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

  const handleOpenFile = useCallback((filePath: string, line?: number) => {
    openFile(filePath, line);
  }, []);

  const [sendMode, setSendMode] = useState<'enter' | 'ctrl-enter'>(() => {
    return (localStorage.getItem('chat-send-mode') as 'enter' | 'ctrl-enter') || 'enter';
  });

  const toggleSendMode = useCallback(() => {
    setSendMode(prev => {
      const next = prev === 'enter' ? 'ctrl-enter' : 'enter';
      localStorage.setItem('chat-send-mode', next);
      return next;
    });
  }, []);

  const initialConfig = useMemo(() => ({
    namespace: `ChatInput-${conversationId}`,
    nodes: [ImageNode, CodeReferenceNode],
    theme: {
      paragraph: 'm-0',
      text: { base: 'text-foreground' },
    },
    onError: (error: Error) => console.error(error),
  }), [conversationId]);

  const slashItems = useMemo(() => ([
    ...buildAgentSlashItems(availableCommands),
    ...buildPromptLibrarySlashItems(promptLibraryItems),
  ]), [availableCommands, promptLibraryItems]);

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

  return (
    <div ref={inputRootRef} style={{ height: customHeight ? `${customHeight}px` : undefined }} className="relative flex-shrink-0 px-4 pb-4 pt-2">
      <div className="mx-auto h-full max-w-4xl flex flex-col">
        <div className="relative flex h-full flex-col rounded-ide border border-border bg-background-secondary shadow-2xl transition-all focus-within:ring-1 focus-within:ring-accent/50">

          <AttachmentBar
            attachments={attachments}
            onRemove={(id) => onAttachmentsChange(attachments.filter(a => a.id !== id))}
            onImageClick={onImageClick}
          />

          <div
            ref={editorContainerRef}
            onKeyDownCapture={combinedHandleKeyDownCapture}
            className={`relative flex min-h-0 flex-1 cursor-text flex-col overflow-y-auto rounded-t-ide bg-background-secondary transition-colors ${isDragOver ? 'bg-accent/5 ring-2 ring-inset ring-accent/50' : ''}`}
          >
            <ChatInputActionsContext.Provider value={{ onImageClick, onOpenFile: handleOpenFile, attachments }}>
              <LexicalComposer initialConfig={initialConfig}>
                <RichTextPlugin
                  contentEditable={
                    <ContentEditable
                      className="outline-none p-3 text-ide-regular text-foreground placeholder:text-foreground/30"
                      spellCheck={false}
                    />
                  }
                  placeholder={
                    <div className="absolute top-3 left-3 text-foreground/30 pointer-events-none text-ide-regular">
                      Type your task here (Paste images with Ctrl+V)
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

          <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-background-secondary/50 rounded-b-ide">
            <div className="flex items-center gap-1">
              <button
                className="p-1.5 rounded text-foreground/60 hover:text-foreground hover:bg-background transition-all outline-none"
                title="Add context"
                onClick={() => {
                   if (typeof window.__attachFile === 'function') {
                       window.__attachFile(conversationId);
                   }
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>

              <div className="h-4 w-[1px] bg-border mx-1" />

              <ChatDropdown
                value={selectedAgentId}
                subValue={selectedModelId}
                options={agentOptions}
                placeholder="Select Agent"
                disabled={isSending}
                onChange={onAgentChange}
                onSubChange={(_agentId, modelId) => {
                  onModelChange(modelId, _agentId);
                }}
              />

              {modeOptions.length > 0 && (
                <ChatDropdown
                  value={selectedModeId}
                  options={modeOptions}
                  placeholder="Mode"
                  minWidthClass="min-w-[80px]"
                  disabled={isSending || !hasSelectedAgent}
                  onChange={onModeChange}
                />
              )}

              {selectedAgentId && (
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

              <ContextUsageIndicator used={contextTokensUsed} size={contextWindowSize} />
            </div>

            <div className="flex items-center gap-2">
              {showVoiceButton && (
                <button
                  type="button"
                  onClick={handleVoiceInput}
                  disabled={isSending || isTranscribing}
                  className={`p-1.5 rounded transition-all outline-none disabled:opacity-40 ${
                    isRecording
                      ? 'text-error hover:bg-error/10'
                      : 'text-foreground/60 hover:text-foreground hover:bg-background'
                  }`}
                  title={isRecording ? 'Stop voice input' : 'Start voice input'}
                >
                  {isTranscribing ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : isRecording ? (
                    <Square size={16} />
                  ) : (
                    <Mic size={16} />
                  )}
                </button>
              )}

              <Tooltip
                content={
                  <div className="normal-case tracking-normal text-left">
                    <div className="font-semibold mb-1">Send mode</div>
                    <div>Click to toggle between sending on Enter or Ctrl+Enter.</div>
                  </div>
                }
              >
                <button
                  type="button"
                  onClick={toggleSendMode}
                  className="text-[10px] text-foreground/40 hover:text-foreground/80 transition-colors uppercase font-medium tracking-wide outline-none relative px-1"
                >
                  {sendMode === 'enter' ? 'Enter' : 'Ctrl+Enter'}
                </button>
              </Tooltip>

              <div className="flex items-center ml-1">
                {isSending ? (
                  <button
                    type="button"
                    onClick={onStop}
                    className="p-1.5 text-error hover:bg-error/10 rounded transition-all outline-none"
                    title="Stop"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onSend}
                    disabled={!inputValue.trim()}
                    className="p-1.5 text-foreground/60 hover:text-accent hover:bg-accent/10 rounded transition-all disabled:opacity-20 outline-none"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </button>
                )}
              </div>
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
