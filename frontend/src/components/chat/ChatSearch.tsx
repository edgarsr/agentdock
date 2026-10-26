import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import type { Message } from '../../types/chat';
import { isShortcut, useKeyDown } from '../../hooks/useShortcuts';
import { assistantMessageTexts } from './AssistantMessage';
import { markdownHtml } from './MarkdownMessage';
import { userMessageTexts } from './UserMessage';
import { chatFocusClassName } from './shared/focusStyles';
import { Tooltip } from './shared/Tooltip';

interface SearchMatch {
  messageId: string;
  messageIndex: number;
  // Position among the matches of the same message.
  ordinal: number;
}

interface ChatSearchOptions {
  messages: Message[];
  isActive: boolean;
  containerRef: RefObject<HTMLDivElement>;
  // Messages before this index are not rendered.
  hiddenCount: number;
  revealMessage: (index: number) => void;
  scrollToRange: (range: Range) => void;
}

const MIN_QUERY_LENGTH = 2;

// Matches the action buttons of the file changes box.
const iconButtonClassName = 'p-1 text-foreground-secondary hover:text-foreground transition-colors '
  + `disabled:pointer-events-none disabled:opacity-40 ${chatFocusClassName}`;

/** Case-insensitive; `wordStart` matches only where a word starts. */
export function searchPattern(query: string, wordStart = false): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return wordStart ? new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, 'giu') : new RegExp(escaped, 'gi');
}

// Ranges of the pattern matches in the text of an element, including matches split across text nodes.
function textRanges(element: Element, pattern: RegExp): Range[] {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push(node);
    starts.push(text.length);
    text += node.data;
  }

  // Matches come in text order, so the node lookup only moves forward.
  let i = 0;
  const point = (offset: number): [Text, number] => {
    while (i < nodes.length - 1 && starts[i + 1] <= offset) i++;
    return [nodes[i], offset - starts[i]];
  };
  return Array.from(text.matchAll(pattern), (match) => {
    const range = new Range();
    range.setStart(...point(match.index!));
    range.setEnd(...point(match.index! + match[0].length));
    return range;
  });
}

// Searches the main text of user and assistant messages, including messages that are not rendered.
// Nothing runs while the search bar is closed, except the shortcut listener of the active chat.
export function useChatSearch({ messages, isActive, containerRef, hiddenCount, revealMessage, scrollToRange }: ChatSearchOptions) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // The current match is chosen when the query changes and then moves only by navigation.
  const [position, setPosition] = useState<{ query: string; index: number | null }>({ query: '', index: null });
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollPendingRef = useRef(false);
  // Rendered text of assistant markdown by message block, kept only while the search is open.
  const markdownTextsRef = useRef(new Map<string, { source: string; text: string }>());

  const matches = useMemo(() => {
    if (!open || query.length < MIN_QUERY_LENGTH) return [];
    const markdownText = (key: string, source: string) => {
      const cached = markdownTextsRef.current.get(key);
      if (cached?.source === source) return cached.text;
      const text = new DOMParser().parseFromString(markdownHtml(source), 'text/html').body.textContent ?? '';
      markdownTextsRef.current.set(key, { source, text });
      return text;
    };
    const pattern = searchPattern(query);
    const result: SearchMatch[] = [];
    messages.forEach((message, messageIndex) => {
      const texts = message.role === 'user'
        ? userMessageTexts(message)
        : assistantMessageTexts(message, (source, i) => markdownText(`${message.id}:${i}`, source));
      let ordinal = 0;
      for (const text of texts) {
        const count = text.match(pattern)?.length ?? 0;
        for (let i = 0; i < count; i++) result.push({ messageId: message.id, messageIndex, ordinal: ordinal++ });
      }
    });
    return result;
  }, [open, query, messages]);

  // While typing, the newest match becomes current only if its message is rendered, so typing reveals nothing.
  const last = matches.length - 1;
  const index = position.query === query ? position.index
    : last >= 0 && matches[last].messageIndex >= hiddenCount ? last : null;
  const current = index !== null && index < matches.length ? index : null;

  useEffect(() => {
    if (position.query === query) return;
    setPosition({ query, index: current });
    scrollPendingRef.current = true;
  }, [query]);

  useEffect(() => {
    const container = containerRef.current;
    if (!isActive || !container || matches.length === 0) return;
    const pattern = searchPattern(query);
    const target = current === null ? null : matches[current];
    const highlight = new Highlight();
    let currentRange: Range | undefined;
    container.querySelectorAll<HTMLElement>('[data-message-id]').forEach((message) => {
      const ranges = Array.from(message.querySelectorAll('[data-search-text]'))
        .flatMap((element) => textRanges(element, pattern));
      ranges.forEach((range) => highlight.add(range));
      if (target && message.dataset.messageId === target.messageId) currentRange = ranges[target.ordinal];
    });
    CSS.highlights.set('chat-search', highlight);
    if (currentRange) {
      const currentHighlight = new Highlight(currentRange);
      currentHighlight.priority = 1;
      CSS.highlights.set('chat-search-current', currentHighlight);
    }
    // A match in a message that is being revealed is scrolled to once the message renders.
    if (scrollPendingRef.current && (!target || target.messageIndex >= hiddenCount)) {
      scrollPendingRef.current = false;
      if (currentRange) scrollToRange(currentRange);
    }
    return () => {
      CSS.highlights.delete('chat-search');
      CSS.highlights.delete('chat-search-current');
    };
  }, [isActive, matches, position, current, hiddenCount]);

  const navigate = (step: 1 | -1) => {
    if (matches.length === 0) return;
    const next = current === null ? matches.length - 1 : (current + step + matches.length) % matches.length;
    setPosition({ query, index: next });
    scrollPendingRef.current = true;
    if (matches[next].messageIndex < hiddenCount) revealMessage(matches[next].messageIndex);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    setPosition({ query: '', index: null });
    markdownTextsRef.current.clear();
    containerRef.current?.focus({ preventScroll: true });
  };

  useKeyDown((event) => {
    if (isShortcut(event, 'search')) {
      const selection = window.getSelection()?.toString().trim();
      if (selection && !selection.includes('\n')) setQuery(selection);
      setOpen(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return true;
    }
    if (event.key !== 'F3' || !open) return false;
    navigate(event.shiftKey ? -1 : 1);
    return true;
  }, isActive);

  const searched = query.length >= MIN_QUERY_LENGTH;
  const counter = !searched ? '' : matches.length === 0 ? '0'
    : `${current === null ? '–' : current + 1}/${matches.length}`;

  // Shown above the chat input, styled like the other boxes there.
  const bar = open && (
    <div className="py-1">
      <div className="flex h-[calc(theme(spacing.9)+2px)] w-full min-w-0 items-center gap-2 rounded-[6px] border border-border
        bg-background-secondary px-3 text-ide-small text-foreground-secondary"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
      >
        <Search size={14} className="shrink-0" aria-hidden="true" />
        <input ref={inputRef} type="text" value={query} placeholder="Search in chat" aria-label="Search in chat"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            navigate(event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? -1 : 1);
          }}
          className={`h-7 min-w-0 flex-1 rounded-[6px] border-0 bg-background mx-1 px-2.5 py-0 ${searched && matches.length === 0 ? 'text-error' : ''}`}
        />
        <span className="shrink-0 tabular-nums">{counter}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip variant="minimal" content="Previous match">
            <button type="button" aria-label="Previous match" disabled={matches.length === 0} onClick={() => navigate(-1)}
              className={iconButtonClassName}>
              <ChevronUp size={14} aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip variant="minimal" content="Next match">
            <button type="button" aria-label="Next match" disabled={matches.length === 0} onClick={() => navigate(1)}
              className={iconButtonClassName}>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip variant="minimal" content="Close">
            <button type="button" aria-label="Close search" onClick={close} className={iconButtonClassName}>
              <X size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );

  return { bar, currentMessageId: current === null ? null : matches[current].messageId };
}
