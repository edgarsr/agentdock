import { useEffect, useRef } from 'react';
import { Message } from '../../types/chat';
import { MarkdownMessage } from './MarkdownMessage';

export default function MessageList({ 
  messages,
  onImageClick
}: { 
  messages: Message[],
  onImageClick: (src: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 100;
    shouldAutoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  };

  useEffect(() => {
    if (shouldAutoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const renderContent = (message: Message) => {
    const isAssistant = message.role === 'assistant';

    if (message.blocks && message.blocks.length > 0) {
      return (
        <div className="space-y-2">
          {message.blocks.map((block, idx) => {
            if (block.type === 'image' && block.data) {
              const src = `data:${block.mimeType || 'image/png'};base64,${block.data}`;
              return (
                <div key={idx} className="my-2">
                  <img 
                    src={src} 
                    alt="Pikums" 
                    className="max-w-full rounded-md shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity" 
                    style={{ maxHeight: '300px' }}
                    onClick={() => onImageClick(src)}
                  />
                </div>
              );
            }
            return isAssistant ? (
              <MarkdownMessage key={idx} content={block.text || ''} />
            ) : (
              <div key={idx} className="whitespace-pre-wrap">{block.text || ''}</div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="">
        {message.content ? (
          isAssistant ? (
            <MarkdownMessage content={message.content} />
          ) : (
            <div className="whitespace-pre-wrap">{message.content}</div>
          )
        ) : (
          <div className="flex gap-1 py-1">
            <div className="w-1.5 h-1.5 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6"
    >
      <div className="max-w-4xl mx-auto">
        {messages.length === 0 && (
          <div className="mt-20 space-y-4 text-center text-foreground/50">Hello, world!</div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} mb-8 animate-in fade-in slide-in-from-bottom-2 duration-300`}>
            <div className={`
              rounded-lg p-4 
              ${message.role === 'user' 
                ? 'max-w-[85%] bg-[var(--ide-editor-bg)] border border-[var(--ide-Borders-color)] ml-auto text-foreground shadow-sm' 
                : 'w-full text-foreground'
              }
            `}>
              <div className="leading-relaxed break-words">
                {renderContent(message)}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
