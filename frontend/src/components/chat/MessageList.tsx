import { useLayoutEffect, useRef, memo, useState, useMemo, useEffect } from 'react';
import { Message, RichContentBlock, ExploringBlock, ToolCallBlock, PlanBlock, AgentOption } from '../../types/chat';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { ChatLoadingIndicator } from './ChatLoadingIndicator';
import { Button } from '../ui/Button';

const BOTTOM_PIN_THRESHOLD_PX = 8;
const READ_ACK_THRESHOLD_PX = 48;
const EARLIER_PROMPTS_BATCH_SIZE = 20;

function countUserMessages(messages: Message[], endExclusive: number): number {
  let count = 0;
  for (let i = 0; i < endExclusive; i++) {
    if (messages[i].role === 'user') count++;
  }
  return count;
}

function expandCutoffByPromptCount(messages: Message[], cutoffIndex: number, promptCount: number): number {
  if (promptCount <= 0 || cutoffIndex <= 0) return cutoffIndex;

  let remainingPrompts = promptCount;
  let nextCutoffIndex = cutoffIndex;

  while (nextCutoffIndex > 0 && remainingPrompts > 0) {
    nextCutoffIndex--;
    if (messages[nextCutoffIndex].role === 'user') {
      remainingPrompts--;
    }
  }

  return nextCutoffIndex;
}

interface MessageListProps {
  messages: Message[];
  onImageClick: (src: string) => void;
  onAtBottomChange?: (isAtBottom: boolean) => void;
  onCanMarkReadChange?: (canMarkRead: boolean) => void;
  isSending?: boolean;
  status?: string;
  agentName?: string;
  agentIconPath?: string;
  availableAgents: AgentOption[];
  isHistoryReplaying?: boolean;
  onForkFromMessage?: (messageId: string) => void;
  scrollToBottomOnInitialMessages?: boolean;
}

function MessageList({ 
  messages,
  onImageClick,
  onAtBottomChange,
  onCanMarkReadChange,
  isSending,
  status,
  agentName,
  agentIconPath,
  availableAgents,
  isHistoryReplaying = false,
  onForkFromMessage,
  scrollToBottomOnInitialMessages = false
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const atBottomChangeRef = useRef(onAtBottomChange);
  const canMarkReadChangeRef = useRef(onCanMarkReadChange);
  const lastAtBottomRef = useRef(true);
  const lastCanMarkReadRef = useRef(true);
  const prevIsReplaying = useRef(isHistoryReplaying);
  const prevIsSendingForScroll = useRef(isSending);
  const prevIsSendingForCollapse = useRef(isSending);
  const initialMessagesScrolledRef = useRef(false);

  const [revealedPromptCount, setRevealedPromptCount] = useState(0);

  useEffect(() => {
    atBottomChangeRef.current = onAtBottomChange;
  }, [onAtBottomChange]);

  useEffect(() => {
    canMarkReadChangeRef.current = onCanMarkReadChange;
  }, [onCanMarkReadChange]);

  const getDistanceFromBottom = (el: HTMLDivElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

  const publishViewportState = (el: HTMLDivElement) => {
    const distanceFromBottom = getDistanceFromBottom(el);
    const isAtBottom = distanceFromBottom < BOTTOM_PIN_THRESHOLD_PX;
    const canMarkRead = distanceFromBottom < READ_ACK_THRESHOLD_PX;

    if (lastAtBottomRef.current !== isAtBottom) {
      lastAtBottomRef.current = isAtBottom;
      atBottomChangeRef.current?.(isAtBottom);
    }

    if (lastCanMarkReadRef.current !== canMarkRead) {
      lastCanMarkReadRef.current = canMarkRead;
      canMarkReadChangeRef.current?.(canMarkRead);
    }
  };

  useEffect(() => {
    if (isHistoryReplaying) {
      setRevealedPromptCount(0);
    }
  }, [isHistoryReplaying]);

  const { visibleMessages, hiddenCount, hiddenPromptCount } = useMemo(() => {
    if (messages.length <= 6) {
      return { visibleMessages: messages, hiddenCount: 0, hiddenPromptCount: 0 };
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

    const effectiveCutoffIndex = expandCutoffByPromptCount(messages, cutoffIndex, revealedPromptCount);

    return {
      visibleMessages: messages.slice(effectiveCutoffIndex),
      hiddenCount: effectiveCutoffIndex,
      hiddenPromptCount: countUserMessages(messages, effectiveCutoffIndex),
    };
  }, [messages, revealedPromptCount]);

  const userPromptNumberById = useMemo(() => {
    const numbering = new Map<string, number>();
    let promptNumber = 0;

    messages.forEach((message) => {
      if (message.role !== 'user') return;
      promptNumber += 1;
      numbering.set(message.id, promptNumber);
    });

    return numbering;
  }, [messages]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    publishViewportState(el);
  };

  const handleExpand = () => {
    const el = containerRef.current;
    if (!el) {
      setRevealedPromptCount((prev) => prev + EARLIER_PROMPTS_BATCH_SIZE);
      return;
    }

    const previousScrollHeight = el.scrollHeight;
    const previousScrollTop = el.scrollTop;

    setRevealedPromptCount((prev) => prev + EARLIER_PROMPTS_BATCH_SIZE);

    // After state update and re-render, adjust scroll to keep relative position
    requestAnimationFrame(() => {
      const newScrollHeight = el.scrollHeight;
      el.scrollTop = previousScrollTop + (newScrollHeight - previousScrollHeight);
    });
  };

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = getDistanceFromBottom(el);
    const isAtBottom = distanceFromBottom < BOTTOM_PIN_THRESHOLD_PX;
    const canMarkRead = distanceFromBottom < READ_ACK_THRESHOLD_PX;
    lastAtBottomRef.current = isAtBottom;
    lastCanMarkReadRef.current = canMarkRead;
    atBottomChangeRef.current?.(isAtBottom);
    canMarkReadChangeRef.current?.(canMarkRead);
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (
      scrollToBottomOnInitialMessages &&
      !initialMessagesScrolledRef.current &&
      messages.length > 0 &&
      !isHistoryReplaying
    ) {
      initialMessagesScrolledRef.current = true;
      el.style.scrollBehavior = 'auto';
      el.scrollTop = el.scrollHeight;
      lastAtBottomRef.current = true;
      lastCanMarkReadRef.current = true;
      publishViewportState(el);
      return;
    }

    const historyJustFinished = prevIsReplaying.current && !isHistoryReplaying;
    const sendingJustStarted = !prevIsSendingForScroll.current && isSending;
    const shouldKeepBottomPinned = !isHistoryReplaying && Boolean(isSending) && lastAtBottomRef.current;

    if (historyJustFinished || sendingJustStarted || shouldKeepBottomPinned) {
      el.style.scrollBehavior = 'auto';
      el.scrollTop = el.scrollHeight;
      lastAtBottomRef.current = true;
      lastCanMarkReadRef.current = true;
    }

    publishViewportState(el);
    prevIsReplaying.current = isHistoryReplaying;
    prevIsSendingForScroll.current = isSending;
  }, [messages, revealedPromptCount, isHistoryReplaying, isSending, scrollToBottomOnInitialMessages]);

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

    setRevealedPromptCount(0);
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
        className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6 opacity-100 transition-opacity duration-300"
      >
      <div className="mx-auto w-full max-w-[1200px] flex flex-col">
        
        {hiddenCount > 0 && !isHistoryReplaying && (
          <div className="flex justify-center mb-12">
            <Button onClick={handleExpand} variant="secondary">
              Show {Math.min(hiddenPromptCount, EARLIER_PROMPTS_BATCH_SIZE)} earlier message{Math.min(hiddenPromptCount, EARLIER_PROMPTS_BATCH_SIZE) > 1 ? 's' : ''}
            </Button>
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
                onFork={!isSending && onForkFromMessage ? () => onForkFromMessage(message.id) : undefined}
              />
            );
          }

          return (
            <UserMessage 
              key={message.id} 
              message={message} 
              onImageClick={onImageClick}
              promptNumber={userPromptNumberById.get(message.id)}
            />
          );
        })}

        {visibleMessages.length === 0 && !isSending && !isHistoryReplaying && agentIconPath && (
          <div className="flex items-center justify-center min-h-[45vh]">
            <img src={agentIconPath}
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
