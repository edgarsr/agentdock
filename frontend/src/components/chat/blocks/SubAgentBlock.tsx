import React from 'react';
import { ToolCallBlock } from '../../../types/chat';
import { ChevronRight } from 'lucide-react';
import { MarkdownMessage } from '../MarkdownMessage';
import { parseToolStatus, safeParseJson } from '../../../utils/toolCallUtils';
import { useAutoCollapse } from '../../../hooks/useAutoCollapse';
import { chatInsetFocusClassName } from '../shared/focusStyles';

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
  const { isExpanded, toggle } = useAutoCollapse();

  const title = block.entry.title || block.entry.kind || 'Thinking...';
  const promptText = (() => {
    const json = safeParseJson(block.entry.rawJson);
    const p = json?.rawInput?.prompt;
    return typeof p === 'string' && p.trim() ? p.trim() : '';
  })();

  return (
    <div className="border border-border rounded-[6px] overflow-hidden mb-2">
      <button onClick={toggle}
        className={`flex items-center gap-2 w-full px-3 h-9 bg-editor-bg ${chatInsetFocusClassName}`}
      >
        <div className="flex-shrink-0 text-editor-fg opacity-70 relative top-[-1px]"><BotIcon size={14} /></div>
        <div className="flex-1 text-left font-mono truncate text-editor-fg opacity-90 pr-2">{title}</div>
        <div className="flex-shrink-0 flex items-center gap-2">
          {(isPending || isError) && (
            <div className={`w-2.5 h-2.5 rounded-full ${isPending ? 'bg-warning animate-pulse' : 'bg-error'}`}/>
          )}
          <div className={`transition-transform duration-200 text-editor-fg opacity-50 ${isExpanded ? 'rotate-90' : ''}`}>
            <ChevronRight size={14} />
          </div>
        </div>
      </button>

      <div className="grid transition-[grid-template-rows] duration-300 ease-in-out overflow-hidden text-ide-small"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div tabIndex={-1} className="p-3 bg-editor-bg max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-border
            scrollbar-track-transparent border-t border-border">

            <div className="leading-relaxed">
              {promptText && (<div className="mb-2"><b>Prompt: </b>{promptText}<hr /></div>)}
              {block.entry.result ? (
                <MarkdownMessage content={block.entry.result} />
              ) : (
                <span className="opacity-40 italic">
                  {isFinished ? 'Subagent finished.' : 'Waiting for response...'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
