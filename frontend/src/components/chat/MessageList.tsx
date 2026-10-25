import { useLayoutEffect, useRef, memo, useState, useMemo, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Message, RichContentBlock, ExploringBlock, PlanBlock, AgentOption } from '../../types/chat';
import { UserMessage, formatPromptTime } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { ChatLoadingIndicator } from './ChatLoadingIndicator';
import { Tooltip } from './shared/Tooltip';
import { Button } from '../ui/Button';
import { useChatSearch } from './ChatSearch';
import { QuoteSelectionButton } from './QuoteSelectionButton';

const BOTTOM_PIN_THRESHOLD_PX = 10;
const READ_ACK_THRESHOLD_PX = 48;
const EARLIER_PROMPTS_BATCH_SIZE = 20;
/** The prompt navigation shows only while the chat content stays 12px clear of its widest dash, which ends at 24px. */
const NAVIGATION_CONTENT_MIN_LEFT_PX = 36;
function promptPreview(message: Message): string {
  const blocks = message.blocks?.length ? message.blocks : message.contentBlocks;
  let text = message.content.slice(0, 161);
  if (blocks?.length) {
    text = '';
    for (const block of blocks) {
      const part = block.type === 'text' ? block.text : block.type === 'quote' ? ` "${block.quote}" `
        : block.type === 'image' ? ' [image] ' : '';
      text += part.slice(0, 161 - text.length);
      if (text.length > 160) break;
    }
  }
  const preview = text.slice(0, 160).replace(/\s+/g, ' ').trim();
  if (preview || !blocks?.length) return preview + (text.length > 160 ? '…' : '');
  const attachment = blocks.find((block) => block.type === 'file' || block.type === 'code_ref');
  if (attachment?.type === 'file' || attachment?.type === 'code_ref') return attachment.name;
  return 'Attachment';
}

function PromptTooltip({ message, number }: { message: Message; number: number }) {
  const time = formatPromptTime(message.timestamp);
  return (
    <>
      <div className="text-xs text-foreground-secondary">#{number}{time && ` · ${time}`}</div>
      <div className="mt-1">{promptPreview(message)}</div>
    </>
  );
}

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
  footer?: ReactNode;
  messages: Message[];
  promptNavigationHoverOnly: boolean;
  onImageClick: (src: string) => void;
  onCanMarkReadChange?: (canMarkRead: boolean) => void;
  isSending?: boolean;
  status?: string;
  agentName?: string;
  agentIconPath?: string;
  availableAgents: AgentOption[];
  isHistoryReplaying?: boolean;
  onForkFromMessage?: (messageId: string) => void;
  scrollToBottomOnInitialMessages?: boolean;
  isActive?: boolean;
}

function MessageList({ 
  footer,
  messages,
  promptNavigationHoverOnly,
  onImageClick,
  onCanMarkReadChange,
  isSending,
  status,
  agentName,
  agentIconPath,
  availableAgents,
  isHistoryReplaying = false,
  onForkFromMessage,
  scrollToBottomOnInitialMessages = false,
  isActive = false
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const footerSpacerRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const navigationScrollIntentRef = useRef(false);
  const promptElementsRef = useRef(new Map<string, HTMLDivElement>());
  const pendingPromptIdRef = useRef<string | null>(null);
  const registerPromptElement = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) promptElementsRef.current.set(id, element);
    else promptElementsRef.current.delete(id);
  }, []);
  const followBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const canMarkReadChangeRef = useRef(onCanMarkReadChange);
  const lastCanMarkReadRef = useRef(true);
  const prevIsReplaying = useRef(isHistoryReplaying);
  const prevIsSendingForScroll = useRef(isSending);
  const prevIsSendingForCollapse = useRef(isSending);
  const initialMessagesScrolledRef = useRef(false);
  const touchStartYRef = useRef<number | null>(null);

  const [revealedPromptCount, setRevealedPromptCount] = useState(0);
  const [navigationEdges, setNavigationEdges] = useState({ atTop: true, atBottom: true });

  useEffect(() => {
    canMarkReadChangeRef.current = onCanMarkReadChange;
  }, [onCanMarkReadChange]);

  const getDistanceFromBottom = (el: HTMLDivElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

  const publishViewportState = useCallback((el: HTMLDivElement) => {
    const canMarkRead = getDistanceFromBottom(el) < READ_ACK_THRESHOLD_PX;
    if (lastCanMarkReadRef.current !== canMarkRead) {
      lastCanMarkReadRef.current = canMarkRead;
      canMarkReadChangeRef.current?.(canMarkRead);
    }
  }, []);

  const updateViewport = useCallback(() => {
    const el = containerRef.current;
    if (!el || el.clientHeight === 0) return;
    if (!isHistoryReplaying && followBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
    }
    publishViewportState(el);
  }, [isHistoryReplaying, publishViewportState]);

  useEffect(() => {
    if (isHistoryReplaying) {
      setRevealedPromptCount(0);
    }
  }, [isHistoryReplaying]);

  const { visibleMessages, hiddenCount, hiddenPromptCount } = useMemo(() => {
    if (messages.length <= 6) {
      return { visibleMessages: messages, hiddenCount: 0, hiddenPromptCount: 0 };
    }

    const SYMBOL_LIMIT = 20000;
    
    // Safely estimate block size without counting base64 media
    const getBlockSize = (block: RichContentBlock): number => {
      if (!block) return 0;
      if (['image', 'audio', 'video', 'file'].includes(block.type)) {
        return 500; // Fixed weight for media/files
      }
      if (block.type === 'code_ref') {
        return 50;
      }
      if (block.type === 'quote') {
        return block.quote.length;
      }
      if (block.type === 'text') {
        return (block as any).text?.length || 0;
      }
      // Fixed weight per tool call: their collapsed rows mount the raw JSON, results and diffs only on expand
      if (block.type === 'exploring') {
        return 100 * ((block as ExploringBlock).entries?.length ?? 0);
      }
      if (block.type === 'tool_call') {
        return 100;
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

  const { userPromptNumberById, prompts } = useMemo(() => {
    const numbering = new Map<string, number>();
    const prompts: Message[] = [];
    let promptNumber = 0;

    messages.forEach((message) => {
      if (message.role !== 'user') return;
      promptNumber++;
      numbering.set(message.id, promptNumber);
      prompts.push(message);
    });

    return { userPromptNumberById: numbering, prompts };
  }, [messages]);
  const previousPromptCountRef = useRef(prompts.length);

  const [navigationFits, setNavigationFits] = useState(false);
  const showNavigation = prompts.length > 1 && !isHistoryReplaying && navigationFits;

  const updateNavigationEdges = useCallback(() => {
    const el = navigationRef.current;
    if (!el) return;
    const atTop = el.scrollTop <= 1;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    setNavigationEdges((previous) =>
      previous.atTop === atTop && previous.atBottom === atBottom ? previous : { atTop, atBottom }
    );
  }, []);

  const markNavigationScrollIntent = () => {
    const el = navigationRef.current;
    if (el && el.scrollHeight > el.clientHeight) navigationScrollIntentRef.current = true;
  };

  useLayoutEffect(() => {
    const el = navigationRef.current;
    if (!el) {
      navigationScrollIntentRef.current = false;
      return;
    }
    const syncNavigation = () => {
      if (!navigationScrollIntentRef.current) el.scrollTop = el.scrollHeight;
      updateNavigationEdges();
    };
    const observer = new ResizeObserver(syncNavigation);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    syncNavigation();
    return () => observer.disconnect();
  }, [showNavigation, prompts.length, updateNavigationEdges]);

  const navigationFade = navigationEdges.atTop
    ? navigationEdges.atBottom
      ? ''
      : '[mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent)] [-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent)]'
    : navigationEdges.atBottom
      ? '[mask-image:linear-gradient(to_bottom,transparent,black_12px)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,black_12px)]'
      : '[mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)]';

  const scrollToPrompt = (id: string) => {
    const el = containerRef.current;
    const target = promptElementsRef.current.get(id);
    if (!el || !target) return;
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top;
    lastScrollTopRef.current = el.scrollTop;
    publishViewportState(el);
  };

  // Reveals hidden messages from the given prompt onwards; 0 reveals all.
  const revealFromPrompt = (promptNumber: number) => {
    setRevealedPromptCount((count) => count + hiddenPromptCount - promptNumber + 1);
  };

  const handlePromptClick = (message: Message, promptNumber: number) => {
    handleUserIntentScrollUp();
    if (promptElementsRef.current.has(message.id)) {
      scrollToPrompt(message.id);
      return;
    }
    pendingPromptIdRef.current = message.id;
    revealFromPrompt(promptNumber);
  };

  const search = useChatSearch({
    messages,
    isActive,
    containerRef,
    hiddenCount,
    revealMessage: (index) => {
      handleUserIntentScrollUp();
      revealFromPrompt(countUserMessages(messages, index + 1));
    },
    scrollToRange: (range) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = range.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const bottom = footerRef.current?.getBoundingClientRect().top ?? box.bottom;
      if (rect.top >= box.top && rect.bottom <= bottom) return;
      handleUserIntentScrollUp();
      el.scrollTop += rect.top + rect.height / 2 - (box.top + bottom) / 2;
      lastScrollTopRef.current = el.scrollTop;
      publishViewportState(el);
    },
  });

  useLayoutEffect(() => {
    const id = pendingPromptIdRef.current;
    if (!id || !promptElementsRef.current.has(id)) return;
    pendingPromptIdRef.current = null;
    scrollToPrompt(id);
  }, [visibleMessages]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    if (el.scrollTop > lastScrollTopRef.current && getDistanceFromBottom(el) < BOTTOM_PIN_THRESHOLD_PX) {
      followBottomRef.current = true;
    }
    lastScrollTopRef.current = el.scrollTop;
    publishViewportState(el);
  };

  const handleUserIntentScrollUp = () => {
    followBottomRef.current = false;
    lastScrollTopRef.current = containerRef.current?.scrollTop ?? 0;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const left = el.getBoundingClientRect().left + el.clientLeft;
    if (e.target === el && (e.clientX < left || e.clientX >= left + el.clientWidth)) {
      handleUserIntentScrollUp();
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      handleUserIntentScrollUp();
    }
  };

  // The footer overlays the message list outside its scroll container, so wheel scrolling that no
  // scrollable footer element consumes is forwarded to the message list.
  const handleFooterWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el || e.ctrlKey || e.deltaY === 0) return;
    for (let node = e.target as HTMLElement | null; node && node !== e.currentTarget; node = node.parentElement) {
      if (node.scrollHeight <= node.clientHeight || !/auto|scroll/.test(getComputedStyle(node).overflowY)) continue;
      if (e.deltaY < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1) return;
    }
    handleWheel(e);
    el.scrollTop += e.deltaY;
  };

  // A click on a non-focusable footer area leaves focus on the body, so keyboard scrolling would
  // target the document instead of the message list.
  const handleFooterClick = () => {
    if (document.activeElement === document.body) containerRef.current?.focus({ preventScroll: true });
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartYRef.current === null) return;
    const currentY = e.touches[0].clientY;
    // Moving finger down (currentY > touchStartYRef.current) scrolls the content UP
    if (currentY > touchStartYRef.current) {
      handleUserIntentScrollUp();
    }
  };

  const handleTouchEnd = () => {
    touchStartYRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) {
      handleUserIntentScrollUp();
    }
  };

  const handleExpand = () => {
    handleUserIntentScrollUp();
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
    const canMarkRead = distanceFromBottom < READ_ACK_THRESHOLD_PX;
    followBottomRef.current = distanceFromBottom < BOTTOM_PIN_THRESHOLD_PX;
    lastScrollTopRef.current = el.scrollTop;
    lastCanMarkReadRef.current = canMarkRead;
    canMarkReadChangeRef.current?.(canMarkRead);
  }, []);

  const hasFooter = Boolean(footer);

  useLayoutEffect(() => {
    const el = containerRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const footerEl = footerRef.current;
    const observer = new ResizeObserver(() => {
      const spacer = footerSpacerRef.current;
      if (footerEl && spacer) {
        const right = `${el.offsetWidth - el.clientWidth}px`;
        const height = `${Math.ceil(footerEl.getBoundingClientRect().height)}px`;
        if (footerEl.style.right !== right) footerEl.style.right = right;
        if (spacer.style.height !== height) spacer.style.height = height;
        // The footer covers the list's bottom: focus scrolling, and menus choosing their side, keep clear of it.
        if (el.style.scrollPaddingBottom !== height) el.style.scrollPaddingBottom = height;
      }
      setNavigationFits(content.offsetLeft >= NAVIGATION_CONTENT_MIN_LEFT_PX);
      updateViewport();
    });
    observer.observe(el);
    observer.observe(content);
    if (footerEl) observer.observe(footerEl);
    return () => observer.disconnect();
  }, [updateViewport, hasFooter]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const newPrompt = prompts.length > previousPromptCountRef.current;
    previousPromptCountRef.current = prompts.length;

    if (
      scrollToBottomOnInitialMessages &&
      !initialMessagesScrolledRef.current &&
      messages.length > 0 &&
      !isHistoryReplaying
    ) {
      initialMessagesScrolledRef.current = true;
      followBottomRef.current = true;
      updateViewport();
      return;
    }

    const historyJustFinished = prevIsReplaying.current && !isHistoryReplaying;
    const sendingJustStarted = !prevIsSendingForScroll.current && isSending;
    if (historyJustFinished || sendingJustStarted || (newPrompt && !isHistoryReplaying)) {
      followBottomRef.current = true;
    }

    updateViewport();
    prevIsReplaying.current = isHistoryReplaying;
    prevIsSendingForScroll.current = isSending;
  }, [messages, prompts.length, revealedPromptCount, isHistoryReplaying, isSending, scrollToBottomOnInitialMessages, updateViewport]);

  useEffect(() => {
    const wasSending = prevIsSendingForCollapse.current;
    prevIsSendingForCollapse.current = isSending;

    if (!wasSending || isSending || isHistoryReplaying || !followBottomRef.current) {
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
      {showNavigation && (
        <nav
          ref={navigationRef}
          aria-label="Conversation prompts"
          onScroll={updateNavigationEdges}
          onWheel={markNavigationScrollIntent}
          onTouchMove={markNavigationScrollIntent}
          onKeyDown={(event) => {
            if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
              markNavigationScrollIntent();
            }
          }}
          // Above the footer (z-50), beside the chat content. It shows from 6px from the edge; the dashes start 14px
          // from it, and the one pointed at widens to 10px.
          className={`absolute top-[45px] bottom-[45px] z-[51] left-[6px] w-[19px] pl-[7px] overflow-y-auto
            overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
            ${promptNavigationHoverOnly ? 'opacity-0 transition-opacity duration-75 hover:duration-200 hover:opacity-100 ' +
            'hover:delay-200 focus-within:opacity-100 focus-within:delay-0' : ''} ${navigationFade}`}
        >
          <div className="flex min-h-full flex-col items-center justify-center">
            {prompts.map((message, index) => (
              <Tooltip
                key={message.id}
                placement="right"
                content={<PromptTooltip message={message} number={index + 1} />}
                contentClassName="max-w-[min(280px,calc(100vw-48px))]"
                className="!w-full"
              >
                <button
                  type="button"
                  aria-label={`Go to prompt ${index + 1}`}
                  onClick={() => handlePromptClick(message, index + 1)}
                  className="group flex h-[8px] w-full shrink-0 cursor-pointer items-center rounded-sm border
                    border-transparent focus-visible:border-[var(--ide-Button-default-focusColor)]"
                >
                  <span className="h-[2px] w-[8px] bg-foreground-secondary opacity-60 group-hover:w-full
                    group-hover:opacity-100 group-focus-visible:w-full group-focus-visible:opacity-100" />
                </button>
              </Tooltip>
            ))}
          </div>
        </nav>
      )}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        data-active-chat-output={isActive || undefined}
        className="relative flex-1 min-h-0 overflow-x-hidden overflow-y-auto scroll-auto [overflow-anchor:none] outline-none
          px-4 app-wide:px-6 opacity-100 transition-opacity duration-300"
      >
      <div ref={contentRef} className="mx-auto min-h-full w-full max-w-app-content flex flex-col">
        <div className="flex flex-1 flex-col pb-12 pt-[calc(1.5rem+var(--content-top-inset,0px))]">
        
        {hiddenCount > 0 && !isHistoryReplaying && (
          <div className="flex justify-center mb-12">
            <Button onClick={handleExpand} variant="outline">
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
                hasFollowingMessage={!isLast}
                agentIconPath={resolvedAgentIconPath}
                isActivePrompt={Boolean(isSending) && isLast && !message.metaComplete && status === 'prompting'}
                onFork={message.metaComplete && onForkFromMessage ? () => onForkFromMessage(message.id) : undefined}
              />
            );
          }

          return (
            <UserMessage
              key={message.id}
              message={message}
              onImageClick={onImageClick}
              promptNumber={userPromptNumberById.get(message.id)}
              onElementChange={registerPromptElement}
              forceExpanded={search.currentMessageId === message.id}
            />
          );
        })}

        {visibleMessages.length === 0 && !isSending && !isHistoryReplaying && agentIconPath && (
          <div className="pointer-events-none absolute inset-x-0 top-[35%] flex -translate-y-1/2 justify-center">
            <img alt="Agent" src={agentIconPath}
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
        {footer && <div ref={footerSpacerRef} aria-hidden="true" className="shrink-0" />}
      </div>
    </div>
    {isActive && <QuoteSelectionButton containerRef={containerRef} />}
    {footer && (
      <div ref={footerRef} onWheel={handleFooterWheel} onClick={handleFooterClick}
        className="absolute bottom-0 left-0 right-0 z-50 bg-background px-4 pt-1 app-wide:px-6">
        <div aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-full h-8 bg-gradient-to-b from-transparent to-background" />
        <div className="relative mx-auto flex w-full max-w-app-content flex-col">
          {search.bar}
          {footer}
        </div>
      </div>
    )}
  </div>
);
}

export default memo(MessageList);
