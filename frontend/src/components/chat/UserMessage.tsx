import { useState, useEffect, useLayoutEffect, useMemo, useRef, memo } from 'react';
import { Message, RichContentBlock, TextBlock, ImageBlock, FileBlock, CodeReferenceBlock } from '../../types/chat';
import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { AttachmentItem } from './shared/AttachmentItem';
import { CodeReferenceChip, QuoteChip } from './shared/ReferenceChip';
import { Tooltip } from './shared/Tooltip';
import { listClassName, parseMarkdownLists, type MarkdownList, type MarkdownListBlock } from './shared/markdownLists';
import { openFile } from '../../utils/openFile';
import { copyPrompt } from '../../utils/promptClipboard';

interface UserMessageProps {
  message: Message;
  onImageClick: (src: string) => void;
  promptNumber?: number;
  onElementChange?: (id: string, element: HTMLDivElement | null) => void;
  // Expands a long prompt that holds the current search match.
  forceExpanded?: boolean;
}

export function formatPromptTime(timestamp?: number): string | null {
  if (timestamp === undefined) return null;

  try {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.getDate() === now.getDate()
      && date.getMonth() === now.getMonth()
      && date.getFullYear() === now.getFullYear();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.getDate() === yesterday.getDate()
      && date.getMonth() === yesterday.getMonth()
      && date.getFullYear() === yesterday.getFullYear();

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const time = `${hours}:${minutes}`;

    if (isToday) return `Today ${time}`;
    if (isYesterday) return `Yesterday ${time}`;

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year} ${time}`;
  } catch {
    return null;
  }
}

function splitBlocks(message: Message) {
  const inline: RichContentBlock[] = [];
  const trailing: RichContentBlock[] = [];
  if (message.blocks) {
    message.blocks.forEach(b => {
      if (b.type === 'file' || (b.type === 'image' && (b as ImageBlock).isInline === false)) {
        trailing.push(b);
      } else {
        inline.push(b);
      }
    });
  }
  return { inline, trailing };
}

// Stands for the inline block at an index, so that lists hold the chips and images among their text.
const INLINE_BLOCK = /\uE000(\d+)\uE000/;

function messageLists(message: Message): { blocks: MarkdownListBlock[]; inline: RichContentBlock[] } {
  const { inline } = splitBlocks(message);
  const text = inline.length === 0 ? message.content : inline
    .map((block, index) => block.type === 'text' ? (block as TextBlock).text : `\uE000${index}\uE000`)
    .join('');
  return { blocks: parseMarkdownLists(text), inline };
}

// Text and the indexes of inline blocks, alternately.
function inlineParts(text: string): string[] {
  return text.split(INLINE_BLOCK);
}

// Text in render order, which the chat search covers.
export function userMessageTexts(message: Message): string[] {
  const texts: string[] = [];
  const addText = (text: string) => inlineParts(text).forEach((part, index) => {
    if (index % 2 === 0 && part) texts.push(part);
  });
  const addList = (list: MarkdownList) => list.items.forEach((item) => {
    addText(item.text);
    item.lists.forEach(addList);
  });
  messageLists(message).blocks.forEach((block) => block.type === 'text' ? addText(block.text) : addList(block.list));
  return texts;
}

export const UserMessage = memo(({ message, onImageClick, promptNumber, onElementChange, forceExpanded = false }: UserMessageProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLargeContent, setIsLargeContent] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Measure before paint so a long prompt is already collapsed when the message list measures its height.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const checkHeight = () => {
      const scrollH = el.scrollHeight;
      setContentHeight(scrollH);
      if (scrollH > 300) {
        setIsLargeContent(true);
      } else {
        setIsLargeContent(false);
      }
    };

    const observer = new ResizeObserver(() => checkHeight());
    observer.observe(el);
    checkHeight();

    return () => observer.disconnect();
  }, [message.content, message.blocks]);

  useEffect(() => {
    if (forceExpanded) setIsExpanded(true);
  }, [forceExpanded]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = () => {
    try {
      setCopied(copyPrompt(message));
    } catch {
      setCopied(false);
    }
  };

  const { trailing } = splitBlocks(message);
  const { blocks, inline } = useMemo(() => messageLists(message), [message.content, message.blocks]);

  const handleOpenFile = (path: string, startLine?: number) => {
    openFile(path, startLine ? startLine - 1 : undefined);
  };

  const renderInlineBlock = (block: RichContentBlock, key: number) => {
    if (block.type === 'image' && (block as ImageBlock).data) {
      const img = block as ImageBlock;
      return (
        <AttachmentItem
          key={key}
          att={{
            id: String(key),
            name: 'Image',
            mimeType: img.mimeType,
            data: img.data
          }}
          onImageClick={onImageClick}
        />
      );
    }
    if (block.type === 'code_ref') {
      const codeRef = block as CodeReferenceBlock;
      return (
        <CodeReferenceChip
          key={key}
          fileName={codeRef.name}
          path={codeRef.path}
          startLine={codeRef.startLine}
          endLine={codeRef.endLine}
          onClick={() => handleOpenFile(codeRef.path, codeRef.startLine)}
          showTooltip={false}
        />
      );
    }
    if (block.type === 'quote') {
      return <QuoteChip key={key} quote={block.quote} />;
    }
    return null;
  };

  // Each text part is a search text of its own, as userMessageTexts lists them.
  const renderInline = (text: string) => inlineParts(text).map((part, index) => index % 2 === 1
    ? inline[Number(part)] && renderInlineBlock(inline[Number(part)], index)
    : part && <span className="cursor-text" key={index} data-search-text>{part}</span>);

  const renderList = (list: MarkdownList, key: number) => {
    const items = list.items.map((item, index) => (
      <li key={index}>
        {renderInline(item.text)}
        {item.lists.map(renderList)}
      </li>
    ));
    return list.ordered
      ? <ol key={key} className={listClassName(true)}>{items}</ol>
      : <ul key={key} className={listClassName(false)}>{items}</ul>;
  };

  const renderContent = () => (
    <div className="whitespace-pre-wrap [&>:last-child]:mb-0">
      {blocks.map((block, index) => block.type === 'list'
        ? renderList(block.list, index)
        : <span key={index}>{renderInline(block.text)}</span>)}
    </div>
  );

  const renderTrailingAttachments = () => {
    if (trailing.length === 0) return null;
    return (
      <div className="flex flex-wrap pt-2 block w-full">
        {trailing.map((block, idx) => {
          if (block.type === 'file') {
            const fb = block as FileBlock;
            return (
              <AttachmentItem key={`trail-${idx}`}
                att={{ id: `trail-${idx}`, name: fb.name, mimeType: fb.mimeType, data: fb.data, path: fb.path }}
                onImageClick={onImageClick}
              />
            );
          }
          const ib = block as ImageBlock;
          return (
            <AttachmentItem key={`trail-${idx}`}
              att={{ id: `trail-${idx}`, name: 'Image', mimeType: ib.mimeType, data: ib.data }}
              onImageClick={onImageClick}
            />
          );
        })}
      </div>
    );
  };

  const formattedTime = formatPromptTime(message.timestamp);
  const showCollapseToggle = isLargeContent;

  const toggleExpanded = () => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
    setIsExpanded((prev) => !prev);
  };

  return (
    <div ref={(element) => onElementChange?.(message.id, element)} data-message-id={message.id} className="flex flex-col">
      <div className="group relative ml-auto flex max-w-[80%] flex-col items-end">
        <div className="user-message-bubble bg-accent rounded-[12px] group max-w-full px-4 pt-3 pb-4 text-foreground"
          style={{backgroundColor: 'var(--user-message-bg)',}}
        >
          <div>
            <div className="relative brightness-[110%]">
              <div ref={contentRef}
                className={`break-words overflow-hidden transition-[max-height] duration-300 ease-in-out ${
                  isLargeContent && !isExpanded
                    ? '[mask-image:linear-gradient(to_bottom,black_calc(100%-64px),transparent)] [-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%-64px),transparent)]'
                    : ''
                }`}
                style={{
                  maxHeight: !isLargeContent
                    ? 'none'
                    : isExpanded
                      ? (contentHeight !== undefined ? `${contentHeight}px` : 'none')
                      : '220px',
                }}
              >
                {renderContent()}
              </div>
            </div>

            {renderTrailingAttachments()}

            {showCollapseToggle && (
              <div className="mt-2 flex">
                <button type="button" onClick={toggleExpanded}
                  className="inline-flex items-center gap-1 text-xs text-foreground hover:underline
                    focus-visible:rounded-[4px] focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                >
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <span>{isExpanded ? 'Show less' : 'Show more'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* The text is dimmed through its colour, not opacity, so the copy button can brighten to full foreground on hover. */}
        {/* The App root sets --user-message-details-opacity to 0 when the details are shown only on hover. */}
        <div className="flex items-center pr-2 pt-2 pb-2.5 gap-2 text-xs
          text-[color-mix(in_srgb,var(--ide-Label-foreground),transparent_20%)]
          opacity-[var(--user-message-details-opacity,1)] transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {promptNumber !== undefined && <span>{`#${promptNumber}`}</span>}
          {promptNumber !== undefined && formattedTime && <span aria-hidden="true">•</span>}
          {formattedTime && <span>{formattedTime}</span>}
          {(promptNumber !== undefined || formattedTime) && <span aria-hidden="true">•</span>}
          <Tooltip variant="minimal" content={copied ? 'Copied' : 'Copy prompt'}>
            <button
              type="button" onClick={handleCopy}
              aria-label={copied ? 'Prompt copied' : 'Copy prompt'}
              className="inline-flex items-center rounded-[4px] hover:text-foreground focus:outline-none
                focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--ide-Button-default-focusColor)]
                focus-visible:outline-offset-2 relative top-px"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});
