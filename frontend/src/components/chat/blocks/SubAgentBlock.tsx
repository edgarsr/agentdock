import React, { useMemo } from 'react';
import { ToolCallBlock } from '../../../types/chat';
import { ChevronRight } from 'lucide-react';
import { MarkdownMessage } from '../MarkdownMessage';
import { parseToolStatus, safeParseJson } from '../../../utils/toolCallUtils';
import { useAutoCollapse } from '../../../hooks/useAutoCollapse';

const BotIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8"></path>
    <rect width="16" height="12" x="4" y="8" rx="2"></rect>
    <path d="M2 14h2"></path>
    <path d="M20 14h2"></path>
    <path d="M15 13v2"></path>
    <path d="M9 13v2"></path>
  </svg>
);

interface Props {
  block: ToolCallBlock;
}

export const SubAgentBlock: React.FC<Props> = ({ block }) => {
  const { isPending, isError, isFinished } = parseToolStatus(block.entry.status);
  const { isExpanded, toggle } = useAutoCollapse(isFinished, block.isReplay);

  const title = block.entry.title || block.entry.kind || 'Thinking...';

  const promptText = useMemo(() => {
    const json = safeParseJson(block.entry.rawJson);
    if (Array.isArray(json.content)) {
      return json.content
        .map((c: { text?: string; content?: { text?: string } }) => c.text || c.content?.text)
        .filter(Boolean)
        .join('\n\n') || null;
    }
    return null;
  }, [block.entry.rawJson]);

  return (
    <div className="my-2 border border-border rounded-md overflow-hidden shadow-sm">
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full px-3 py-2 bg-editor-bg hover:bg-secondary transition-colors group border-b border-border"
      >
        <div className="flex-shrink-0 text-editor-fg opacity-70 relative top-[-1px]">
          <BotIcon size={14} />
        </div>
        <div className="flex-1 text-left text-[12px] font-mono truncate text-editor-fg opacity-90 pr-2">
          {title}
        </div>
        <div className="flex-shrink-0 flex items-center gap-2">
          {(isPending || isError) && (
            <div
              className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.3)] ${
                isPending ? 'bg-orange-500 animate-pulse' : 'bg-error'
              }`}
            />
          )}
          <div className={`transition-transform duration-200 text-editor-fg opacity-50 ${isExpanded ? 'rotate-90' : ''}`}>
            <ChevronRight size={14} />
          </div>
        </div>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out overflow-hidden"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="p-3 bg-editor-bg max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
            {promptText && (
              <div className="mb-4 pb-4 border-b border-border/30">
                <div className="text-[10px] tracking-wider opacity-40 mb-2 font-semibold">Subagent task</div>
                <div className="text-[13px] leading-relaxed opacity-80 italic">
                  <MarkdownMessage content={promptText} />
                </div>
              </div>
            )}

            <div className="text-[13px] leading-relaxed">
              {block.entry.result ? (
                <MarkdownMessage content={block.entry.result} />
              ) : (
                <span className="opacity-40 italic">
                  {isFinished ? 'Subagent finished with no response.' : 'Waiting for response...'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
