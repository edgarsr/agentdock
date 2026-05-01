import { memo } from 'react';
import type { ExploringBlock, Message, RichContentBlock, TextBlock } from '../../types/chat';
import { MarkdownMessage } from './MarkdownMessage';
import { ContentBlockRenderer } from './blocks/ContentBlockRenderer';
import { Tooltip } from './shared/Tooltip';
import { GitFork } from 'lucide-react';

interface AssistantMessageProps {
  message: Message;
  onImageClick: (src: string) => void;
  showBorder: boolean;
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
  return `${year}-${month}-${day} ${hours}:${minutes}`;
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

function isThoughtExploringBlock(block: RichContentBlock): block is ExploringBlock {
  return block.type === 'exploring' && block.entries.length > 0 && block.entries.every((entry) => entry.kind === 'thinking');
}

function isTextBlock(block: RichContentBlock): block is TextBlock {
  return block.type === 'text';
}

function groupAssistantBlocks(blocks: RichContentBlock[]) {
  const groups: Array<{ key: string; blocks: RichContentBlock[] }> = [];

  for (let i = 0; i < blocks.length; i++) {
    const current = blocks[i];
    const next = blocks[i + 1];

    if (isThoughtExploringBlock(current) && next && isTextBlock(next)) {
      groups.push({ key: `thought-${i}`, blocks: [current, next] });
      i++;
      continue;
    }

    groups.push({ key: `block-${i}`, blocks: [current] });
  }

  return groups;
}

export const AssistantMessage = memo(({ message, onImageClick, showBorder, agentIconPath, isActivePrompt = false, onFork }: AssistantMessageProps) => {
  const renderContent = () => {
    if (message.contentBlocks && message.contentBlocks.length > 0) {
      const groupedBlocks = groupAssistantBlocks(message.contentBlocks);
      return (
        <div className="flex flex-col gap-2 [&>.markdown-body]:my-0">
          {groupedBlocks.map((group) => (
            <div key={group.key} className={`flex flex-col [&>.markdown-body]:my-0 ${group.blocks.length > 1 ? 'gap-1' : ''}`}>
              {group.blocks.map((block, idx) => (
                <ContentBlockRenderer key={`${group.key}-${idx}`} block={block} isActivePrompt={isActivePrompt} />
              ))}
            </div>
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
                    className="max-w-full rounded-md shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity"
                    style={{ maxHeight: '300px' }}
                    onClick={() => onImageClick(src)}
                  />
                </div>
              );
            }
            return <MarkdownMessage key={idx} content={(block as any).text || ''} />;
          })}
        </div>
      );
    }

    return (
      <div className="[&>.markdown-body]:my-0">
        {message.content ? <MarkdownMessage content={message.content} /> : null}
      </div>
    );
  };

  const promptTime = formatPromptTime(message.promptStartedAtMillis);
  const duration = formatDuration(message.duration);
  const contextUsage = formatContextUsage(message.contextTokensUsed, message.contextWindowSize);
  const showMeta = !!message.metaComplete;

  const tooltipRows = [
    promptTime ? { label: 'Prompt time', value: promptTime } : null,
    duration ? { label: 'Duration', value: duration } : null,
    message.agentName ? { label: 'Agent', value: message.agentName } : null,
    message.modelName ? { label: 'Model', value: message.modelName } : null,
    message.modeName ? { label: 'Mode', value: message.modeName } : null,
    contextUsage ? { label: 'Context', value: contextUsage } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);
  const hasMetaTooltip = tooltipRows.length > 0;

  const agentBadge = agentIconPath ? (
    <img src={agentIconPath} alt={message.agentName || 'Agent'} className="w-4 h-4 opacity-80"/>
  ) : (
    <div className="w-4 h-4 rounded bg-background-secondary border border-border flex items-center justify-center
      text-[9px] font-semibold uppercase opacity-80">
      {(message.agentName || '?').slice(0, 1)}
    </div>
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex justify-start mb-2">
        <div className="w-full text-foreground">
          <div className="break-words">
            {renderContent()}
          </div>
        </div>
      </div>

      <div className={showMeta || onFork || showBorder ? 'mt-8' : ''}>
        {(showMeta || onFork) && (
          <div className="flex justify-end items-center gap-2 mb-4 text-foreground-secondary">
            {onFork && (
              <Tooltip content="Fork from here" variant="minimal">
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-secondary
                  hover:bg-hover hover:text-foreground focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]
                  focus-visible:outline-none"
                  onClick={onFork}
                  aria-label="Fork from here"
                >
                  <GitFork size={13} />
                </button>
              </Tooltip>
            )}
            {showMeta && (hasMetaTooltip ? (
              <Tooltip
                content={
                  <div className="min-w-[190px] space-y-1.5">
                    {tooltipRows.map((row) => (
                      <div key={row.label} className="flex justify-between gap-2 text-xs">
                        <span className="text-foreground-secondary">{row.label}</span>
                        <span className="text-foreground text-right">{row.value}</span>
                      </div>
                    ))}
                  </div>
                }
              >
                <div className="cursor-help">{agentBadge}</div>
              </Tooltip>
            ) : (
              agentBadge
            ))}
          </div>
        )}

        {showBorder && <div className="border-b border-border -mx-4 mb-8" />}
      </div>
    </div>
  );
});

