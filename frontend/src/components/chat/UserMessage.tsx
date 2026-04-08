import { useState, useEffect, useRef, memo } from 'react';
import { Message, RichContentBlock, TextBlock, ImageBlock, FileBlock, CodeReferenceBlock } from '../../types/chat';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AttachmentItem } from './shared/AttachmentItem';
import { CodeReferenceChip } from './shared/CodeReferenceChip';
import { openFile } from '../../utils/openFile';

interface UserMessageProps {
  message: Message;
  onImageClick: (src: string) => void;
  promptNumber?: number;
}

function formatPromptTime(timestamp?: number): string | null {
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
    return `${day}/${month}/${year} ${time}`;
  } catch {
    return null;
  }
}

export const UserMessage = memo(({ message, onImageClick, promptNumber }: UserMessageProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLargeContent, setIsLargeContent] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const checkHeight = () => {
      if (el.scrollHeight > 300) {
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

  const getBlocks = () => {
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
  };

  const { inline, trailing } = getBlocks();

  const handleOpenFile = (path: string, startLine?: number) => {
    openFile(path, startLine ? startLine - 1 : undefined);
  };

  const renderContent = () => {
    if (inline.length > 0) {
      return (
        <div className="whitespace-pre-wrap">
          {inline.map((block, idx) => {
            if (block.type === 'image' && (block as ImageBlock).data) {
              const img = block as ImageBlock;
              return (
                <AttachmentItem
                  key={idx}
                  att={{
                    id: String(idx),
                    name: 'Image',
                    mimeType: img.mimeType,
                    data: img.data
                  }}
                  onImageClick={onImageClick}
                  flushLeft={idx === 0}
                />
              );
            }
            if (block.type === 'code_ref') {
              const codeRef = block as CodeReferenceBlock;
              return (
                <CodeReferenceChip
                  key={idx}
                  fileName={codeRef.name}
                  path={codeRef.path}
                  startLine={codeRef.startLine}
                  endLine={codeRef.endLine}
                  onClick={() => handleOpenFile(codeRef.path, codeRef.startLine)}
                />
              );
            }
            return <span className="cursor-text" key={idx}>{block.type === 'text' ? (block as TextBlock).text : ''}</span>;
          })}
        </div>
      );
    }
    return <div className="whitespace-pre-wrap">{message.content}</div>;
  };

  const renderTrailingAttachments = () => {
    if (trailing.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-2 mt-3 block w-full">
        {trailing.map((block, idx) => {
          if (block.type === 'file') {
            const fb = block as FileBlock;
            return (
              <AttachmentItem key={`trail-${idx}`}
                att={{ id: `trail-${idx}`, name: fb.name, mimeType: fb.mimeType, data: fb.data }}
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
  const showFooter = showCollapseToggle || promptNumber !== undefined || !!formattedTime;

  return (
    <div className="flex flex-col mb-8 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex justify-end relative">
        <div className="user-message-bubble bg-accent rounded-[6px] group max-w-[85%] text-primary-foreground px-3 py-2"
          style={{backgroundColor: 'var(--user-message-bg)',}}
        >
          <div className="opacity-90">
            <div className="relative">
              <div ref={contentRef}
                className={`break-words transition-[max-height] duration-500 ease-in-out overflow-hidden ${
                  isLargeContent && !isExpanded ? 'max-h-[220px]' : 'max-h-[5000px]'
                }`}
                style={{ maxHeight: isLargeContent ? undefined : 'none' }}
              >
                {renderContent()}
              </div>

              {!isExpanded && isLargeContent && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t
                  from-[var(--user-message-bg)] via-[color-mix(in_srgb,var(--user-message-bg),transparent_10%)]
                  to-transparent" />
              )}
            </div>

            {renderTrailingAttachments()}

            {showFooter && (
              <div className={`mt-1 flex items-center gap-3 ${showCollapseToggle ? 'justify-between' : 'justify-end'}`}>
                {showCollapseToggle && (
                  <button type="button" onClick={() => setIsExpanded(!isExpanded)}
                    className="inline-flex items-center gap-1 text-xs opacity-75 hover:underline
                    focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    <span>{isExpanded ? 'Show less' : 'Show more'}</span>
                  </button>
                )}

                <div className="flex items-center gap-1.5 text-xs opacity-75">
                  {promptNumber !== undefined && <span>{`#${promptNumber}`}</span>}
                  {promptNumber !== undefined && formattedTime && <span aria-hidden="true">•</span>}
                  {formattedTime && <span>{formattedTime}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
