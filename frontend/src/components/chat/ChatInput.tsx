import { useCallback, useMemo, useRef, useState } from 'react';
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

import ChatDropdown from './ChatDropdown';
import { DropdownOption } from '../../types/chat';
import AttachmentBar from './input/AttachmentBar';
import { Tooltip } from './shared/Tooltip';

// Sub-components & Plugins
import { ChatInputActionsContext } from './input/ChatInputActionsContext';
import { ImageNode, $createImageNode } from './input/ImageNode';
import { AttachmentsSyncPlugin, PasteLogPlugin, KeyboardPlugin, AutoHeightPlugin, ClickToFocusPlugin, ClearEditorPlugin } from './input/ChatInputPlugins';

interface ChatInputProps {
  chatId: string;
  inputValue: string;
  onInputChange: (val: string) => void;
  onSend: () => void;
  onStop: () => void;
  isSending: boolean;
  
  agentOptions: DropdownOption[];
  selectedAgentId: string;
  onAgentChange: (id: string) => void;
  selectedModelId: string;
  onModelChange: (id: string) => void;

  modeOptions: DropdownOption[];
  selectedModeId: string;
  onModeChange: (id: string) => void;

  hasSelectedAgent: boolean;
  
  attachments: { id: string; name: string; mimeType: string; data?: string; path?: string; isInline?: boolean }[];
  onAttachmentsChange: (items: { id: string; name: string; mimeType: string; data?: string; path?: string; isInline?: boolean }[]) => void;
  onImageClick: (src: string) => void;
  onHeightChange?: (contentHeight: number) => void;
  customHeight?: number;
}


export default function ChatInput({
  chatId,
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
  modeOptions,
  selectedModeId,
  onModeChange,
  hasSelectedAgent,
  attachments,
  onAttachmentsChange,
  onImageClick,
  onHeightChange,
  customHeight = 180
}: ChatInputProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);

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
    namespace: `ChatInput-${chatId}`,
    nodes: [ImageNode],
    theme: {
      paragraph: 'm-0',
      text: { base: 'text-foreground' },
    },
    onError: (error: Error) => console.error(error),
  }), [chatId]);

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

  return (
    <div style={{ height: customHeight ? `${customHeight}px` : undefined }} className="flex-shrink-0 px-4 pb-4 pt-2">
      <div className="max-w-4xl mx-auto h-full flex flex-col">
        <div className="bg-background-secondary rounded-ide border border-border shadow-2xl focus-within:ring-1 focus-within:ring-accent/50 transition-all flex flex-col h-full relative">
          
          <AttachmentBar
            attachments={attachments}
            onRemove={(id) => onAttachmentsChange(attachments.filter(a => a.id !== id))}
            onImageClick={onImageClick}
          />

          {/* Lexical Editor */}
          <div 
            ref={editorContainerRef}
            className="relative flex-1 overflow-y-auto rounded-t-ide min-h-0 bg-background-secondary flex flex-col"
          >
            <ChatInputActionsContext.Provider value={{ onImageClick, attachments }}>
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
                <OnChangePlugin onChange={(editorState) => {
                  editorState.read(() => {
                    const text = $getRoot().getTextContent();
                    if (text !== inputValue) onInputChange(text);
                  });
                }} />
                <ClearEditorPlugin inputValue={inputValue} />
                <AttachmentsSyncPlugin attachments={attachments} onAttachmentsChange={onAttachmentsChange} />
                <PasteLogPlugin onImagePaste={handleImagePaste} />
                <KeyboardPlugin onSend={onSend} sendMode={sendMode} />
                {onHeightChange && <AutoHeightPlugin onHeightChange={onHeightChange} />}
                <ClickToFocusPlugin containerRef={editorContainerRef} />
              </LexicalComposer>
            </ChatInputActionsContext.Provider>
          </div>

          {/* Bottom Bar Controls */}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-background-secondary/50 rounded-b-ide">
            <div className="flex items-center gap-1">
              <button
                className="p-1.5 rounded text-foreground/60 hover:text-foreground hover:bg-background transition-all outline-none"
                title="Add context"
                onClick={() => {
                   if (typeof window.__attachFile === 'function') {
                       window.__attachFile(chatId);
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
                onSubChange={(agentId, modelId) => {
                  onAgentChange(agentId);
                  onModelChange(modelId);
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
            </div>

            <div className="flex items-center gap-2">
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
    </div>
  );
}
