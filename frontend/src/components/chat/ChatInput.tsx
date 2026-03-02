import ChatDropdown from './ChatDropdown';
import { DropdownOption } from '../../types/chat';

interface ChatInputProps {
  inputValue: string;
  onInputChange: (val: string) => void;
  onSend: () => void;
  onStop: () => void;
  isSending: boolean;
  
  agentOptions: DropdownOption[];
  selectedAgentId: string;
  onAgentChange: (id: string) => void;

  modelOptions: DropdownOption[];
  selectedModelId: string;
  onModelChange: (id: string) => void;

  modeOptions: DropdownOption[];
  selectedModeId: string;
  onModeChange: (id: string) => void;

  hasSelectedAgent: boolean;
  
  attachments: { id: string; data: string; mimeType: string }[];
  onAttachmentsChange: (items: { id: string; data: string; mimeType: string }[]) => void;
  onImageClick: (src: string) => void;
}

export default function ChatInput({
  inputValue,
  onInputChange,
  onSend,
  onStop,
  isSending,
  agentOptions,
  selectedAgentId,
  onAgentChange,
  modelOptions,
  selectedModelId,
  onModelChange,
  modeOptions,
  selectedModeId,
  onModeChange,
  hasSelectedAgent,
  attachments,
  onAttachmentsChange,
  onImageClick
}: ChatInputProps) {

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = (event.target?.result as string).split(',')[1];
            const id = Math.random().toString(36).substring(2, 9);
            const newAtt = { id, data: base64, mimeType: file.type };
            onAttachmentsChange([...attachments, newAtt]);
            
            // Insert placeholder at cursor
            const textarea = e.target as HTMLTextAreaElement;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;
            const placeholder = `[image-${id}]`;
            const newVal = text.substring(0, start) + placeholder + text.substring(end);
            onInputChange(newVal);
            
            // Set cursor after placeholder
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;
            }, 0);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const removeAttachment = (id: string) => {
    onAttachmentsChange(attachments.filter(a => a.id !== id));
    // Also remove any placeholders in text
    onInputChange(inputValue.replace(`[image-${id}]`, ''));
  };

  return (
    <div className="flex-shrink-0 px-4 pb-4 pt-2">
      <div className="max-w-4xl mx-auto">
        <div className="bg-background-secondary rounded-xl border border-border shadow-2xl focus-within:ring-1 focus-within:ring-ring transition-all">
          
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3 border-b border-border bg-black/5">
              {attachments.map(att => (
                <div key={att.id} className="relative group w-16 h-16 rounded border border-border overflow-hidden bg-background shadow-sm">
                  <img 
                    src={`data:${att.mimeType};base64,${att.data}`} 
                    className="w-full h-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity" 
                    onClick={() => onImageClick(`data:${att.mimeType};base64,${att.data}`)}
                  />
                  <button 
                    onClick={() => removeAttachment(att.id)}
                    className="absolute top-0 right-0 p-0.5 bg-error text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white px-1 truncate">
                    {att.id}
                  </div>
                </div>
              ))}
            </div>
          )}

          <textarea
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={3}
            placeholder="Type your task here (Paste images with Ctrl+V)"
            disabled={isSending}
            className="w-full p-4 bg-transparent border-0 outline-none resize-none text-foreground placeholder-foreground/30 disabled:opacity-50"
          />

          <div className="flex items-center justify-between px-3 py-2 border-t border-border">
            {/* Left Controls */}
            <div className="flex items-center gap-1">
              <button
                className="p-1.5  rounded text-foreground/60 hover:text-foreground transition-colors"
                title="Add context"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>

              <div className="h-4 w-[1px] border-l border-border mx-1" />

              <ChatDropdown
                value={selectedAgentId}
                options={agentOptions}
                placeholder="Select Agent"
                disabled={isSending}
                onChange={onAgentChange}
              />

              {modeOptions.length > 0 && (
                <div className="h-4 w-[1px] border-l border-border mx-1" />
              )}
              {modeOptions.length > 0 && (
                <ChatDropdown
                  value={selectedModeId}
                  options={modeOptions}
                  placeholder="Mode"
                  header="Mode"
                  minWidthClass="min-w-[100px]"
                  disabled={isSending || !hasSelectedAgent}
                  onChange={onModeChange}
                />
              )}
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-3">
              <ChatDropdown
                value={selectedModelId}
                options={modelOptions}
                placeholder="Select Model"
                header="Model"
                disabled={isSending || !hasSelectedAgent}
                direction="up"
                onChange={onModelChange}
              />

              <div className="flex items-center gap-2">
                {isSending ? (
                  <button
                    type="button"
                    onClick={onStop}
                    className="p-1.5 bg-transparent text-error hover:opacity-80 transition-all translate-y-[1px]"
                    title="Stop generating"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    </svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onSend}
                    disabled={!inputValue.trim()}
                    className="p-1.5 bg-transparent text-foreground/60 hover:text-accent transition-all disabled:opacity-20 translate-y-[1px]"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
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
