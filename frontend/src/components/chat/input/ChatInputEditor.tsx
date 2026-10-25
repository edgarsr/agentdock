import { KeyboardEvent, RefObject, useMemo } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $getRoot, LexicalEditor } from 'lexical';
import { ChatAttachment } from '../../../types/chat';
import { ChatInputActionsContext } from './ChatInputActionsContext';
import { ImageNode } from './ImageNode';
import { ReferenceNode } from './ReferenceNode';
import {
  AttachmentsSyncPlugin,
  AutoHeightPlugin,
  ClickToFocusPlugin,
  ClearEditorPlugin,
  ExternalReferencePlugin,
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
  onSend?: () => void;
  onKeyDownCapture?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onEditorReady?: (editor: LexicalEditor) => void;
  placeholder?: string;
}

export function ChatInputEditor({
  conversationId,
  composerRevision,
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
  onSend,
  onKeyDownCapture,
  onEditorReady,
  placeholder = 'Type your task here, @ to add files, / for commands',
}: ChatInputEditorProps) {
  const initialConfig = useMemo(() => ({
    namespace: `ChatInput-${conversationId}`,
    nodes: [ImageNode, ReferenceNode],
    theme: { paragraph: 'm-0', text: { base: 'text-foreground' } },
    onError: (error: Error) => console.error(error),
  }), [conversationId, composerRevision]);

  return (
    <div ref={editorContainerRef} onKeyDownCapture={onKeyDownCapture}
      className={`relative flex min-h-0 flex-1 cursor-text flex-col overflow-y-auto rounded-t-ide transition-colors
        ${isDragOver ? 'bg-accent/5 ring-2 ring-inset ring-accent/50' : ''}`}
    >
      <ChatInputActionsContext.Provider value={{ onImageClick, onOpenFile, attachments }}>
        <LexicalComposer key={`chat-input-${conversationId}-${composerRevision}`} initialConfig={initialConfig}>
          <RichTextPlugin contentEditable={
              <ContentEditable className="outline-none p-3 text-foreground" spellCheck={false}/>
            }
            placeholder={
              <div className="absolute top-3 left-3 text-foreground-secondary pointer-events-none">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          {onEditorReady && <RegisterEditorPlugin onReady={onEditorReady} />}
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
          <PasteLogPlugin attachments={attachments} onAttachmentsChange={onAttachmentsChange} />
          <KeyboardPlugin onSend={onSend} sendMode={sendMode} disabled={isSlashMenuOpen} />
          <PlainTextFormattingGuardPlugin />
          <InlineAttachmentBackspacePlugin />
          <ExternalReferencePlugin
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
