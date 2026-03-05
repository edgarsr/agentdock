import { useEffect, useLayoutEffect, useRef, memo } from 'react';
import { Message } from '../../types/chat';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { ChatLoadingIndicator } from './ChatLoadingIndicator';

interface MessageListProps {
  messages: Message[];
  onImageClick: (src: string) => void;
  isSending?: boolean;
  status?: string;
  agentName?: string;
  isHistoryReplaying?: boolean;
  onReadyToReveal?: () => void;
}

function MessageList({ 
  messages,
  onImageClick,
  isSending,
  status,
  agentName,
  isHistoryReplaying = false,
  onReadyToReveal
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const prevIsReplaying = useRef(isHistoryReplaying);

  useLayoutEffect(() => {
    // Detect the exact moment history loading finishes
    if (prevIsReplaying.current && !isHistoryReplaying) {
      const el = containerRef.current;
      if (el) {
        // 1. Force absolute instant scroll position
        el.style.scrollBehavior = 'auto';
        el.scrollTop = el.scrollHeight;

        // 2. We use rAF to ensure the browser has actually performed the layout 
        // before we signal the parent to remove the 'invisible' class.
        let frames = 0;
        const lockAndReveal = () => {
          if (!el) return;
          el.scrollTop = el.scrollHeight; // Keep locking it
          frames++;
          if (frames < 3) {
            requestAnimationFrame(lockAndReveal);
          } else {
            // Only after 3 frames of confirmed bottom position we reveal
            onReadyToReveal?.();
            // Re-enable smooth scrolling for future messages
            setTimeout(() => {
              if (el) el.style.scrollBehavior = 'smooth';
            }, 100);
          }
        };
        requestAnimationFrame(lockAndReveal);
      }
    }
    prevIsReplaying.current = isHistoryReplaying;
  }, [isHistoryReplaying, onReadyToReveal]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 150;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    shouldAutoScroll.current = isAtBottom;
  };

  useEffect(() => {
    if (!isHistoryReplaying && shouldAutoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isHistoryReplaying]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto p-8 space-y-6"
      style={{ scrollBehavior: isHistoryReplaying ? 'auto' : 'smooth' }}
    >
      <div className="max-w-4xl mx-auto w-full flex flex-col">
        {messages.map((message, index) => {
          const isAssistant = message.role === 'assistant';
          const isLast = index === messages.length - 1;

          if (isAssistant) {
            return (
              <AssistantMessage 
                key={message.id} 
                message={message} 
                onImageClick={onImageClick} 
                showBorder={!isLast}
              />
            );
          }

          return (
            <UserMessage 
              key={message.id} 
              message={message} 
              onImageClick={onImageClick} 
            />
          );
        })}

        {isSending && !isHistoryReplaying && (
          <div className="flex justify-start mb-8">
            <ChatLoadingIndicator status={status} agentName={agentName} />
          </div>
        )}

        <div ref={messagesEndRef} className="h-4" />
      </div>
    </div>
  );
}

export default memo(MessageList);
