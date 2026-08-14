import { ComponentProps, KeyboardEvent, RefObject } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $getRoot, LexicalEditor } from 'lexical';
import { ChatAttachment } from '../../../types/chat';
import { ChatInputActionsContext } from './ChatInputActionsContext';
import {
  AttachmentsSyncPlugin,
  AutoHeightPlugin,
  ClickToFocusPlugin,
  ClearEditorPlugin,
  ExternalCodeReferencePlugin,
  InlineAttachmentBackspacePlugin,
  KeyboardPlugin,
  LoadComposerDraftPlugin,
  PasteLogPlugin,
  PlainTextFormattingGuardPlugin,
  RegisterEditorPlugin,
} from './ChatInputPlugins';

interface ChatInputEditorProps {
  conversationId: string;
  composerRevision: number;
  initialConfig: ComponentProps<typeof LexicalComposer>['initialConfig'];
  editorContainerRef: RefObject<HTMLDivElement>;
  inputValue: string;
  composerLoadRevision: number;
  attachments: ChatAttachment[];
  sendMode: 'enter' | 'ctrl-enter';
  isActive: boolean;
  isDragOver: boolean;
  isSlashMenuOpen: boolean;
  onInputChange: (value: string) => void;
  onAttachmentsChange: (items: ChatAttachment[]) => void;
  onImageClick: (src: string) => void;
  onOpenFile: (filePath: string, line?: number) => void;
  onHeightChange?: (contentHeight: number) => void;
  onImagePaste: (file: File, editor: LexicalEditor) => void;
  onSend: () => void;
  onKeyDownCapture: (event: KeyboardEvent<HTMLDivElement>) => void;
  onEditorReady: (editor: LexicalEditor) => void;
}

export function ChatInputEditor({
  conversationId,
  composerRevision,
  initialConfig,
  editorContainerRef,
  inputValue,
  composerLoadRevision,
  attachments,
  sendMode,
  isActive,
  isDragOver,
  isSlashMenuOpen,
  onInputChange,
  onAttachmentsChange,
  onImageClick,
  onOpenFile,
  onHeightChange,
  onImagePaste,
  onSend,
  onKeyDownCapture,
  onEditorReady,
}: ChatInputEditorProps) {
  return (
    <div ref={editorContainerRef} onKeyDownCapture={onKeyDownCapture}
      className={`relative flex min-h-0 flex-1 cursor-text flex-col overflow-y-auto rounded-t-ide transition-colors
        ${isDragOver ? 'bg-accent/5 ring-2 ring-inset ring-accent/50' : ''}`}
    >
      <ChatInputActionsContext.Provider value={{ onImageClick, onOpenFile, attachments }}>
        <LexicalComposer key={`chat-input-${conversationId}-${composerRevision}`} initialConfig={initialConfig}>
          <RichTextPlugin contentEditable={
              <ContentEditable className="outline-none p-3 text-foreground placeholder:text-foreground" spellCheck={false}/>
            }
            placeholder={
              <div className="absolute top-3 left-3 text-foreground-secondary pointer-events-none">
                Type your task here, @ to add files, / for commands
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <RegisterEditorPlugin onReady={onEditorReady} />
          <OnChangePlugin onChange={(editorState) => {
            editorState.read(() => {
              const text = $getRoot().getTextContent();
              if (text !== inputValue) onInputChange(text);
            });
          }} />
          <ClearEditorPlugin inputValue={inputValue} />
          <AttachmentsSyncPlugin attachments={attachments} onAttachmentsChange={onAttachmentsChange} />
          <LoadComposerDraftPlugin
            revision={composerLoadRevision}
            inputValue={inputValue}
            attachments={attachments}
          />
          <PasteLogPlugin onImagePaste={onImagePaste} />
          <KeyboardPlugin onSend={onSend} sendMode={sendMode} disabled={isSlashMenuOpen} />
          <PlainTextFormattingGuardPlugin />
          <InlineAttachmentBackspacePlugin />
          <ExternalCodeReferencePlugin
            isActive={isActive}
            attachments={attachments}
            onAttachmentsChange={onAttachmentsChange}
          />
          {onHeightChange && (
            <AutoHeightPlugin
              onHeightChange={onHeightChange}
              scrollContainerRef={editorContainerRef}
            />
          )}
          <ClickToFocusPlugin containerRef={editorContainerRef} />
        </LexicalComposer>
      </ChatInputActionsContext.Provider>
    </div>
  );
}
