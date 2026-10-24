import { memo, useCallback, useEffect, useId, type MouseEvent } from 'react';
import type { ExploringBlock, Message, RichContentBlock, TextBlock, ToolCallBlock } from '../../types/chat';
import { MarkdownMessage } from './MarkdownMessage';
import { ContentBlockRenderer } from './blocks/ContentBlockRenderer';
import { WorkingBlock } from './blocks/WorkingBlock';
import { Tooltip } from './shared/Tooltip';
import { PopupMenu, popupMenuActions, type PopupMenuAction } from '../ui/PopupMenu';
import { stopSpeech, toggleSpeech, useSpeechState } from '../audio/speechOutput';
import { Copy, EllipsisVertical, GitFork, Square, Volume2, VolumeX } from 'lucide-react';

interface AssistantMessageProps {
  message: Message;
  onImageClick: (src: string) => void;
  hasFollowingMessage: boolean;
  agentIconPath?: string;
  isActivePrompt?: boolean;
  onFork?: () => void;
}

function formatDuration(seconds?: number): string | null {
  if (seconds === undefined) return null;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(0).padStart(2, '0')}`;
}

function formatPromptTime(timestamp?: number): string | null {
  if (timestamp === undefined) return null;
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

function formatContextUsage(used?: number, size?: number): string | null {
  if (used === undefined && size === undefined) return null;
  if (used !== undefined && size !== undefined && size > 0) {
    const percent = ((used / size) * 100).toFixed(1);
    return `${used.toLocaleString()} / ${size.toLocaleString()} (${percent}%)`;
  }
  if (used !== undefined) return used.toLocaleString();
  return size!.toLocaleString();
}

function isTextBlock(block: RichContentBlock): block is TextBlock {
  return block.type === 'text';
}

function isWorkBlock(block: RichContentBlock | undefined): block is ExploringBlock | ToolCallBlock {
  return block?.type === 'exploring'
    || (block?.type === 'tool_call' && ['edit', 'delete', 'move'].includes(block.entry.kind ?? ''));
}

// Markdown sources of the main text in render order, which the chat search covers.
export function assistantMessageTexts(message: Message): string[] {
  if (message.contentBlocks?.length) return message.contentBlocks.filter(isTextBlock).map((block) => block.text);
  if (message.blocks?.length) {
    return message.blocks.filter((block) => !(block.type === 'image' && block.data)).map((block) => (block as any).text || '');
  }
  return message.content ? [message.content] : [];
}

function groupAssistantBlocks(blocks: RichContentBlock[]) {
  const groups: Array<{ key: string; block: RichContentBlock; work?: Array<ExploringBlock | ToolCallBlock> }> = [];

  for (let i = 0; i < blocks.length; i++) {
    const current = blocks[i];

    if (isWorkBlock(current)) {
      const work = [current];
      while (isWorkBlock(blocks[i + 1])) work.push(blocks[++i] as ExploringBlock | ToolCallBlock);
      groups.push({ key: `work-${i - work.length + 1}`, block: current, work });
      continue;
    }

    groups.push({ key: `block-${i}`, block: current });
  }

  return groups;
}

export const AssistantMessage = memo(({ message, onImageClick, hasFollowingMessage, agentIconPath, isActivePrompt = false, onFork }: AssistantMessageProps) => {
  const contentBlocks = message.contentBlocks?.length ? message.contentBlocks : message.blocks;
  const copyText = contentBlocks?.length
    ? contentBlocks.filter(isTextBlock).map((block) => block.text).join('\n\n')
    : message.content;
  // Replayed history reuses message ids across chats, so speech belongs to this mounted message.
  const speechId = useId();
  const speechState = useSpeechState(speechId);
  const speechLabel = speechState.status === 'speaking' ? 'Stop reading'
    : speechState.status === 'error' ? `Reading aloud failed: ${speechState.error}` : 'Read aloud';

  useEffect(() => () => stopSpeech(speechId), [speechId]);

  // The menu opens upwards, so the most used action comes last, next to the button.
  const actions: PopupMenuAction[] = [
    ...(onFork ? [{ label: 'Fork from here', icon: <GitFork size={12} aria-hidden="true" />, onClick: onFork }] : []),
    ...(copyText && speechState.status !== 'unavailable' ? [{
      label: speechState.status === 'speaking' ? 'Stop reading' : 'Read aloud',
      icon: speechState.status === 'speaking' ? <Square size={12} aria-hidden="true" /> : <Volume2 size={12} aria-hidden="true" />,
      onClick: () => toggleSpeech(speechId, copyText),
    }] : []),
    ...(copyText ? [{
      label: 'Copy response',
      icon: <Copy size={12} aria-hidden="true" />,
      onClick: () => { navigator.clipboard.writeText(copyText).catch(() => {}); },
    }] : []),
  ];

  const renderContent = () => {
    if (message.contentBlocks && message.contentBlocks.length > 0) {
      const groupedBlocks = groupAssistantBlocks(message.contentBlocks);
      return (
        <div className="flex flex-col gap-2 [&>.markdown-body]:my-0">
          {groupedBlocks.map((group, groupIdx) => group.work ? (
            <WorkingBlock key={group.key} blocks={group.work} isOpen={isActivePrompt && groupIdx === groupedBlocks.length - 1}
              isActivePrompt={isActivePrompt} onImageClick={onImageClick} />
          ) : (
            <ContentBlockRenderer key={group.key} block={group.block} onImageClick={onImageClick} />
          ))}
        </div>
      );
    }

    if (message.blocks && message.blocks.length > 0) {
      return (
        <div className="flex flex-col gap-2 [&>.markdown-body]:my-0">
          {message.blocks.map((block, idx) => {
            if (block.type === 'image' && block.data) {
              const src = `data:${block.mimeType || 'image/png'};base64,${block.data}`;
              return (
                <div key={idx}>
                  <img src={src} alt=""
                    className="block mx-auto max-w-full rounded-lg cursor-zoom-in hover:opacity-90 transition-opacity"
                    style={{ maxHeight: '300px' }}
                    onClick={() => onImageClick(src)}
                  />
                </div>
              );
            }
            return <MarkdownMessage key={idx} content={(block as any).text || ''} searchable />;
          })}
        </div>
      );
    }

    return (
      <div className="[&>.markdown-body]:my-0">
        {message.content ? <MarkdownMessage content={message.content} searchable /> : null}
      </div>
    );
  };

  const handleReplyImageClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const img = (event.target as HTMLElement | null)?.closest('img');
    if (!img || !img.closest('.markdown-body')) return;
    const src = img.getAttribute('src')?.trim();
    if (!src) return;
    event.preventDefault();
    onImageClick(src);
  }, [onImageClick]);

  const promptTime = formatPromptTime(message.promptStartedAtMillis);
  const duration = formatDuration(message.duration);
  const contextUsage = formatContextUsage(message.contextTokensUsed, message.contextWindowSize);
  const showMeta = !!message.metaComplete;

  const tooltipRows = [
    promptTime ? { label: 'Prompt time', value: promptTime } : null,
    duration ? { label: 'Duration', value: duration } : null,
    message.agentName ? { label: 'Agent', value: message.agentName } : null,
    ...(message.configOptions ?? []).map((option) => ({
      label: option.name,
      value: option.displayValue || option.value,
    })),
    contextUsage ? { label: 'Context', value: contextUsage } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);
  const hasMetaTooltip = tooltipRows.length > 0;

  const agentBadge = agentIconPath ? (
    <img src={agentIconPath} alt={message.agentName || 'Agent'} className="w-4 h-4 opacity-80 hover:opacity-100"/>
  ) : (
    <div className="w-4 h-4 rounded bg-background-secondary border border-border flex items-center justify-center
      text-[9px] font-semibold uppercase opacity-80 hover:opacity-100">
      {(message.agentName || '?').slice(0, 1)}
    </div>
  );

  return (
    <div data-message-id={message.id} className={hasFollowingMessage ? 'mt-4 mb-8' : 'mt-4'}>
      <div className="break-words text-foreground" onClick={handleReplyImageClick}>
        {renderContent()}
      </div>

      {showMeta && (
        <div className="ml-0.5 mt-4 flex items-center gap-2 text-foreground-secondary">
          <Tooltip
            content={hasMetaTooltip ? (
                <div className="min-w-[190px] space-y-1.5">
                  {tooltipRows.map((row) => (
                    <div key={row.label} className="flex justify-between gap-2 text-xs">
                      <span className="text-foreground-secondary">{row.label}</span>
                      <span className="text-foreground text-right">{row.value}</span>
                    </div>
                  ))}
                </div>
              ) : (message.agentName || 'Agent')}
          >
            <button type="button" aria-label={`${message.agentName || 'Agent'} details`}
              className="flex h-4 w-4 items-center justify-center rounded-[4px] cursor-help focus:outline-none
                focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--ide-Button-default-focusColor)] focus-visible:outline-offset-0"
            >
              {agentBadge}
            </button>
          </Tooltip>
          {actions.length > 0 && (
            <PopupMenu
              placement="top"
              inline
              renderTrigger={(trigger) => (
                <Tooltip content="Actions" variant="minimal">
                  <button
                    type="button"
                    aria-label="Actions"
                    {...trigger}
                    className="flex -my-1 h-5 w-5 items-center justify-center rounded text-foreground-secondary
                    hover:bg-hover hover:text-foreground focus-visible:outline focus-visible:outline-1
                    focus-visible:outline-[var(--ide-Button-default-focusColor)] focus-visible:outline-offset-0"
                  >
                    <EllipsisVertical size={14} />
                  </button>
                </Tooltip>
              )}
            >
              {popupMenuActions(actions)}
            </PopupMenu>
          )}
          {/* Reading aloud stays stoppable, and its failure visible, without opening the menu. */}
          {copyText && (speechState.status === 'speaking' || speechState.status === 'error') && (
            <Tooltip content={speechLabel} variant="minimal">
              <button
                type="button"
                className={`flex mx-0.5 h-4 w-4 items-center justify-center rounded
                hover:bg-hover hover:text-foreground focus-visible:outline focus-visible:outline-1
                focus-visible:outline-[var(--ide-Button-default-focusColor)] focus-visible:outline-offset-0
                ${speechState.status === 'error' ? 'text-error' : 'text-foreground-secondary'}`}
                onClick={() => toggleSpeech(speechId, copyText)}
                aria-label={speechLabel}
              >
                {speechState.status === 'speaking' ? <Square size={12} /> : <VolumeX size={14} />}
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
});
