import { useLayoutEffect, useRef, memo, useState, useMemo, useEffect } from 'react';
import { Message, RichContentBlock, ExploringBlock, ToolCallBlock, PlanBlock, AgentOption } from '../../types/chat';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { ChatLoadingIndicator } from './ChatLoadingIndicator';

interface MessageListProps {
  messages: Message[];
  onImageClick: (src: string) => void;
  onAtBottomChange?: (isAtBottom: boolean) => void;
  isSending?: boolean;
  status?: string;
  agentName?: string;
  agentIconPath?: string;
  availableAgents: AgentOption[];
  isHistoryReplaying?: boolean;
}

function MessageList({ 
  messages,
  onImageClick,
  onAtBottomChange,
  isSending,
  status,
  agentName,
  agentIconPath,
  availableAgents,
  isHistoryReplaying = false
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastAtBottomRef = useRef(true);
  const prevIsReplaying = useRef(isHistoryReplaying);
  const prevIsSendingForScroll = useRef(isSending);
  const prevIsSendingForCollapse = useRef(isSending);

  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (isHistoryReplaying) {
      setIsExpanded(false);
    }
  }, [isHistoryReplaying]);

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
      if (block.type === 'code_ref') {
        return 50;
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
    if (lastAtBottomRef.current !== isAtBottom) {
      lastAtBottomRef.current = isAtBottom;
      onAtBottomChange?.(isAtBottom);
    }
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
    const el = containerRef.current;
    if (!el) return;
    const threshold = 150;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    lastAtBottomRef.current = isAtBottom;
    onAtBottomChange?.(isAtBottom);
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const historyJustFinished = prevIsReplaying.current && !isHistoryReplaying;
    const sendingJustStarted = !prevIsSendingForScroll.current && isSending;
    const shouldKeepBottomPinned = !isHistoryReplaying && lastAtBottomRef.current;

    if (historyJustFinished || sendingJustStarted || shouldKeepBottomPinned) {
      el.style.scrollBehavior = 'auto';
      el.scrollTop = el.scrollHeight;
      lastAtBottomRef.current = true;
    }

    const threshold = 150;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (lastAtBottomRef.current !== isAtBottom) {
      lastAtBottomRef.current = isAtBottom;
      onAtBottomChange?.(isAtBottom);
    }
    prevIsReplaying.current = isHistoryReplaying;
    prevIsSendingForScroll.current = isSending;
  }, [messages, isExpanded, isHistoryReplaying, isSending, onAtBottomChange]);

  useEffect(() => {
    const wasSending = prevIsSendingForCollapse.current;
    prevIsSendingForCollapse.current = isSending;

    if (!wasSending || isSending || isHistoryReplaying || !lastAtBottomRef.current) {
      return;
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return;
    }

    setIsExpanded(false);
  }, [messages, isSending, isHistoryReplaying]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {isHistoryReplaying && messages.length === 0 && status === 'initializing' && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-foreground-secondary text-sm">
            {`Connect to ${agentName || 'agent'}...`}
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-8 space-y-6 opacity-100 transition-opacity duration-300"
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
            const resolvedAgentIconPath = message.agentId
              ? availableAgents.find((agent) => agent.id === message.agentId)?.iconPath
              : undefined;

            return (
              <AssistantMessage 
                key={message.id} 
                message={message} 
                onImageClick={onImageClick} 
                showBorder={!isLast}
                agentIconPath={resolvedAgentIconPath}
                isActivePrompt={Boolean(isSending) && isLast}
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

        {visibleMessages.length === 0 && !isSending && !isHistoryReplaying && agentIconPath && (
          <div className="flex items-center justify-center min-h-[45vh]">
            <img
              src={agentIconPath}
              alt=""
              className="w-14 h-14 opacity-60 select-none pointer-events-none"
            />
          </div>
        )}

        {isSending && !isHistoryReplaying && (
          <div className="flex justify-start mb-8">
            <ChatLoadingIndicator status={status} agentName={agentName} />
          </div>
        )}
      </div>
    </div>
  </div>
);
}

export default memo(MessageList);
