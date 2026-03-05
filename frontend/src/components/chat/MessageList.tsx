import { useLayoutEffect, useRef, memo, useState, useMemo } from 'react';
import { Message, RichContentBlock, ExploringBlock, ToolCallBlock, PlanBlock } from '../../types/chat';
import { Loader2 } from 'lucide-react';
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
}

function MessageList({ 
  messages,
  onImageClick,
  isSending,
  status,
  agentName,
  isHistoryReplaying = false
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const prevIsReplaying = useRef(isHistoryReplaying);
  const prevIsSending = useRef(isSending);

  const [isExpanded, setIsExpanded] = useState(false);

  // Synchronously reset expansion to avoid 1-frame flashes before useEffect kicks in
  if (isHistoryReplaying && isExpanded) {
    setIsExpanded(false);
  }

  const { visibleMessages, hiddenCount } = useMemo(() => {
    if (isExpanded || messages.length <= 6) {
      return { visibleMessages: messages, hiddenCount: 0 };
    }

    const SYMBOL_LIMIT = 15000;
    
    // Safely estimate block size without counting base64 media
    const getBlockSize = (block: RichContentBlock): number => {
      if (!block) return 0;
      if (['image', 'audio', 'video', 'file'].includes(block.type)) {
        return 500; // Fixed weight for media/files
      }
      if (block.type === 'text') {
        return (block as any).text?.length || 0;
      }
      if (block.type === 'exploring') {
        const exp = block as ExploringBlock;
        return exp.entries ? JSON.stringify(exp.entries).length : 0;
      }
      if (block.type === 'tool_call') {
        const tc = block as ToolCallBlock;
        return tc.entry ? JSON.stringify(tc.entry).length : 0;
      }
      if (block.type === 'plan') {
         const plan = block as PlanBlock;
         return plan.entries ? JSON.stringify(plan.entries).length : 0;
      }
      return 0;
    };

    const getMessageSize = (msg: Message) => {
      let size = (msg.content || '').length;
      const allBlocks = [...(msg.blocks || []), ...(msg.contentBlocks || [])];
      for (const b of allBlocks) {
        size += getBlockSize(b);
      }
      return size;
    };

    let totalSize = 0;
    let cutoffIndex = 0;
    
    // Go backwards from newest to oldest
    for (let i = messages.length - 1; i >= 0; i--) {
      // Always show at least the last 6 messages (ensures last 3 full interactions are visible)
      if (i >= messages.length - 6) {
        totalSize += getMessageSize(messages[i]);
        continue;
      }
      
      const size = getMessageSize(messages[i]);
      if (totalSize + size > SYMBOL_LIMIT) {
        cutoffIndex = i + 1;
        break;
      }
      totalSize += size;
    }

    return {
      visibleMessages: messages.slice(cutoffIndex),
      hiddenCount: cutoffIndex
    };
  }, [messages, isExpanded]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 150;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    shouldAutoScroll.current = isAtBottom;
  };

  const handleExpand = () => {
    const el = containerRef.current;
    if (!el) {
      setIsExpanded(true);
      return;
    }

    const previousScrollHeight = el.scrollHeight;
    const previousScrollTop = el.scrollTop;

    setIsExpanded(true);

    // After state update and re-render, adjust scroll to keep relative position
    requestAnimationFrame(() => {
      const newScrollHeight = el.scrollHeight;
      el.scrollTop = previousScrollTop + (newScrollHeight - previousScrollHeight);
    });
  };

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    if (prevIsReplaying.current && !isHistoryReplaying) {
      shouldAutoScroll.current = true;
      container.style.scrollBehavior = 'auto';
      container.scrollTop = container.scrollHeight;
    }
    else if (!prevIsSending.current && isSending) {
      // Don't modify isExpanded here to avoid jumps; it is handled by sync check at start
      shouldAutoScroll.current = true;     
      
      if (messagesEndRef.current) {
        container.style.scrollBehavior = 'smooth';
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
    else if (!isHistoryReplaying && shouldAutoScroll.current && messagesEndRef.current) {
      container.style.scrollBehavior = 'smooth';
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }

    prevIsReplaying.current = isHistoryReplaying;
    prevIsSending.current = isSending;
  }, [messages, isHistoryReplaying, isSending]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {isHistoryReplaying && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="flex items-center gap-3 text-foreground-secondary text-sm">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>
              {messages.length === 0
                ? `Connect to ${agentName || 'agent'}...` 
                : 'Loading chat...'}
            </span>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`flex-1 min-h-0 overflow-y-auto p-8 space-y-6 ${
          isHistoryReplaying ? 'opacity-0' : 'opacity-100 transition-opacity duration-300'
        }`}
      >
      <div className="max-w-4xl mx-auto w-full flex flex-col">
        
        {hiddenCount > 0 && !isHistoryReplaying && (
          <div className="flex justify-center mb-6">
            <button
              onClick={handleExpand}
              className="px-4 py-2 flex items-center gap-2 text-xs font-medium text-foreground-secondary hover:text-foreground hover:bg-accent transition-colors border border-border rounded-md"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 5 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="5"></line>
              </svg>
              Show {Math.ceil(hiddenCount / 2)} earlier message{Math.ceil(hiddenCount / 2) > 1 ? 's' : ''}
            </button>
          </div>
        )}

        {visibleMessages.map((message, index) => {
          const isAssistant = message.role === 'assistant';
          const isLast = index === visibleMessages.length - 1;

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
  </div>
);
}

export default memo(MessageList);
