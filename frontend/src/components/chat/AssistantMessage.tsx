import { memo } from 'react';
import { Info } from 'lucide-react';
import type { Message } from '../../types/chat';
import { MarkdownMessage } from './MarkdownMessage';
import { ContentBlockRenderer } from './blocks/ContentBlockRenderer';
import { Tooltip } from './shared/Tooltip';

interface AssistantMessageProps {
  message: Message;
  onImageClick: (src: string) => void;
  showBorder: boolean;
  agentIconPath?: string;
  isActivePrompt?: boolean;
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

export const AssistantMessage = memo(({ message, onImageClick, showBorder, agentIconPath, isActivePrompt = false }: AssistantMessageProps) => {
  const renderContent = () => {
    if (message.contentBlocks && message.contentBlocks.length > 0) {
      return (
        <div className="flex flex-col">
          {message.contentBlocks.map((block, idx) => (
            <ContentBlockRenderer key={idx} block={block} isActivePrompt={isActivePrompt} />
          ))}
        </div>
      );
    }

    if (message.blocks && message.blocks.length > 0) {
      return (
        <div className="space-y-2">
          {message.blocks.map((block, idx) => {
            if (block.type === 'image' && block.data) {
              const src = `data:${block.mimeType || 'image/png'};base64,${block.data}`;
              return (
                <div key={idx} className="my-2">
                  <img
                    src={src}
                    alt=""
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
      <div>
        {message.content ? <MarkdownMessage content={message.content} /> : null}
      </div>
    );
  };

  const showMeta = !!message.metaComplete;
  const promptTime = formatPromptTime(message.promptStartedAtMillis);
  const duration = formatDuration(message.duration);
  const contextUsage = formatContextUsage(message.contextTokensUsed, message.contextWindowSize);

  const tooltipRows = [
    promptTime ? { label: 'Prompt time', value: promptTime } : null,
    duration ? { label: 'Duration', value: duration } : null,
    message.agentName ? { label: 'Agent', value: message.agentName } : null,
    message.modelName ? { label: 'Model', value: message.modelName } : null,
    message.modeName ? { label: 'Mode', value: message.modeName } : null,
    contextUsage ? { label: 'Context', value: contextUsage } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex justify-start mb-2">
        <div className="w-full text-foreground">
          <div className="leading-relaxed break-words">
            {renderContent()}
          </div>
        </div>
      </div>

      <div className={(showMeta || showBorder) ? 'mt-8' : ''}>
        {showMeta && (
          <div className="flex justify-end items-center gap-2 mb-2 text-foreground-secondary">
            {agentIconPath ? (
              <img
                src={agentIconPath}
                alt={message.agentName || 'Agent'}
                className="w-4 h-4 rounded-sm opacity-90"
              />
            ) : (
              <div className="w-4 h-4 rounded-sm bg-background-secondary border border-border flex items-center justify-center text-[9px] font-semibold uppercase opacity-80">
                {(message.agentName || '?').slice(0, 1)}
              </div>
            )}
            {(promptTime || duration || contextUsage) && (
              <Tooltip
                content={
                  <div className="min-w-[220px] space-y-1.5">
                    {tooltipRows.map((row) => (
                      <div key={row.label} className="flex justify-between gap-3 text-xs">
                        <span className="text-foreground-secondary">{row.label}</span>
                        <span className="text-foreground font-mono text-right">{row.value}</span>
                      </div>
                    ))}
                  </div>
                }
              >
                <button
                  type="button"
                  className="inline-flex items-center justify-center w-5 h-5 rounded-sm text-foreground-secondary hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Info size={14} />
                </button>
              </Tooltip>
            )}
          </div>
        )}

        {showBorder && <div className="border-b border-border -mx-8" />}
      </div>
    </div>
  );
});

