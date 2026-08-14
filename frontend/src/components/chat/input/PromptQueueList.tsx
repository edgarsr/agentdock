import { KeyboardEvent, useRef, useState } from 'react';
import { ChevronRight, GripVertical, ListOrdered, Pencil, SendHorizontal, Trash2 } from 'lucide-react';
import { ChatAttachment } from '../../../types/chat';
import { QueuedPrompt } from '../../../hooks/chatSession/promptQueueTypes';
import { chatFocusClassName, chatInsetFocusClassName } from '../shared/focusStyles';
import { Tooltip } from '../shared/Tooltip';

interface PromptQueueListProps {
  items: QueuedPrompt[];
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
  onReorder: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
  onSendNow: (id: string) => void;
  sendNowCancelsCurrent?: boolean;
}

function attachmentPlaceholder(attachment: ChatAttachment): string {
  if (attachment.mimeType.startsWith('image/')) return '[image]';
  if (attachment.mimeType.startsWith('audio/')) return '[audio]';
  if (attachment.mimeType.startsWith('video/')) return '[video]';

  const startLine = attachment.startLine;
  const endLine = attachment.endLine;
  const lineSuffix = startLine
    ? `:${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ''}`
    : '';
  return `[@${attachment.name}${lineSuffix}]`;
}

function promptPreview(item: QueuedPrompt): string {
  const attachmentsById = new Map(item.attachments.map((attachment) => [attachment.id, attachment]));
  const usedAttachmentIds = new Set<string>();
  const placeholderRegex = /\[(image|code-ref)-([a-z0-9-]+)]/g;

  const inlinePreview = item.composerText.replace(placeholderRegex, (placeholder, _type, id: string) => {
    const attachment = attachmentsById.get(id);
    if (!attachment) return placeholder;
    usedAttachmentIds.add(id);
    return attachmentPlaceholder(attachment);
  });

  const trailingPlaceholders = item.attachments
    .filter((attachment) => !usedAttachmentIds.has(attachment.id))
    .map(attachmentPlaceholder);

  return [inlinePreview, ...trailingPlaceholders]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || item.text.replace(/\s+/g, ' ').trim();
}

export function PromptQueueList({
  items,
  onRemove,
  onEdit,
  onReorder,
  onSendNow,
  sendNowCancelsCurrent = false,
}: PromptQueueListProps) {
  const [expanded, setExpanded] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) return null;

  const toggleExpanded = () => setExpanded((value) => !value);

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleExpanded();
  };

  const findDropTarget = (sourceId: string, clientX: number, clientY: number) => {
    const rowElements = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-queued-prompt-id]') ?? [],
    );
    for (const element of rowElements) {
      const id = element.dataset.queuedPromptId;
      if (!id || id === sourceId) continue;

      const rect = element.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        continue;
      }
      return {
        id,
        position: clientY < rect.top + rect.height / 2 ? 'before' as const : 'after' as const,
      };
    }
    return null;
  };

  const scrollListDuringDrag = (clientY: number) => {
    const list = listRef.current;
    if (!list) return;

    const rect = list.getBoundingClientRect();
    const edgeSize = 24;
    if (clientY < rect.top + edgeSize) {
      list.scrollTop -= 12;
    } else if (clientY > rect.bottom - edgeSize) {
      list.scrollTop += 12;
    }
  };

  const handleReorderKeyDown = (
    id: string,
    index: number,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

    const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
    const target = items[targetIndex];
    if (!target) return;

    event.preventDefault();
    onReorder(id, target.id, event.key === 'ArrowUp' ? 'before' : 'after');
  };

  const handleDragPointerDown = (id: string, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;

    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let latestDropTarget: { id: string; position: 'before' | 'after' } | null = null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const distance = Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY);
      if (distance < 4) return;

      moved = true;
      setDraggingId(id);
      scrollListDuringDrag(moveEvent.clientY);
      latestDropTarget = findDropTarget(id, moveEvent.clientX, moveEvent.clientY);
      setDropTarget(latestDropTarget);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      setDraggingId(null);
      setDropTarget(null);
    };

    const onPointerUp = () => {
      cleanup();

      if (moved && latestDropTarget) {
        onReorder(id, latestDropTarget.id, latestDropTarget.position);
      }
    };

    const onPointerCancel = () => {
      cleanup();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  };

  return (
    <div className="border-t border-border px-4 py-2">
      <div className="mx-auto w-full max-w-[1200px] overflow-hidden rounded-[6px] border border-border bg-editor-bg">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          className={`group/header flex h-9 w-full cursor-pointer items-center bg-editor-bg px-3 transition-colors ${chatInsetFocusClassName}`}
          onClick={toggleExpanded}
          onKeyDown={handleHeaderKeyDown}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 text-ide-small text-foreground-secondary">
            <ListOrdered size={14} />
            <span className="relative top-[1px] truncate whitespace-nowrap">
              {items.length} queued {items.length === 1 ? 'message' : 'messages'}
            </span>
          </div>
          <div className={`p-1 text-foreground-secondary transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>
            <ChevronRight size={14} />
          </div>
        </div>

        <div
          className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-in-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        >
          <div className={`overflow-hidden border-t bg-editor-bg transition-colors duration-300 ${expanded ? 'border-border' : 'border-transparent'}`}>
            <div
              ref={listRef}
              className={`max-h-48 overflow-y-auto py-1 ${draggingId ? 'select-none' : ''}`}
            >
              {items.map((item, index) => {
                const preview = promptPreview(item);
                return (
                  <div
                    key={item.id}
                    data-queued-prompt-id={item.id}
                    className="relative flex h-9 items-center gap-2 px-3"
                  >
                    {dropTarget?.id === item.id ? (
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-x-2 z-10 h-px bg-primary ${
                          dropTarget.position === 'before' ? 'top-0' : 'bottom-0'
                        }`}
                      />
                    ) : null}
                    <button
                      type="button"
                      onPointerDown={(event) => handleDragPointerDown(item.id, event)}
                      onKeyDown={(event) => handleReorderKeyDown(item.id, index, event)}
                      className={`shrink-0 touch-none rounded p-1 text-foreground-secondary transition-colors hover:text-foreground ${
                        draggingId === item.id ? 'cursor-grabbing text-foreground' : 'cursor-grab'
                      } ${chatFocusClassName}`}
                      aria-label="Drag to reorder queued message"
                    >
                      <GripVertical size={14} />
                    </button>
                    <Tooltip content={preview} className="min-w-0 flex-1">
                      <span className="block truncate whitespace-nowrap text-ide-small text-foreground-secondary">
                        {preview}
                      </span>
                    </Tooltip>

                    <div className="flex shrink-0 items-center gap-1">
                      <Tooltip
                        variant="minimal"
                        content={sendNowCancelsCurrent ? 'Cancel current and send' : 'Send now'}
                      >
                        <button
                          type="button"
                          onClick={() => onSendNow(item.id)}
                          className={`rounded p-1 text-foreground-secondary transition-colors hover:text-foreground ${chatFocusClassName}`}
                          aria-label={sendNowCancelsCurrent ? 'Cancel current and send queued message' : 'Send queued message now'}
                        >
                          <SendHorizontal size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip variant="minimal" content="Edit">
                        <button
                          type="button"
                          onClick={() => onEdit(item.id)}
                          className={`rounded p-1 text-foreground-secondary transition-colors hover:text-foreground ${chatFocusClassName}`}
                          aria-label="Edit queued message"
                        >
                          <Pencil size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip variant="minimal" content="Remove">
                        <button
                          type="button"
                          onClick={() => onRemove(item.id)}
                          className={`rounded p-1 text-foreground-secondary transition-colors hover:text-deleted ${chatFocusClassName}`}
                          aria-label="Remove queued message"
                        >
                          <Trash2 size={14} />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
