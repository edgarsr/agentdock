import React from 'react';
import { ToolCallBlock } from '../../../types/chat';
import { ChevronRight, SquareTerminal } from 'lucide-react';
import { parseToolStatus } from '../../../utils/toolCallUtils';
import { useAutoCollapse } from '../../../hooks/useAutoCollapse';

const TerminalIcon = () => (
  <SquareTerminal size={16} className="text-primary" />
);

interface Props {
  block: ToolCallBlock;
}

export const ExecuteBlock: React.FC<Props> = ({ block }) => {
  const { isPending, isError, isFinished } = parseToolStatus(block.entry.status);
  const { isExpanded, toggle } = useAutoCollapse();

  const rawCommand = block.entry.title || block.entry.kind || 'Terminal Command';
  const command = String(rawCommand).replace(/^`|`$/g, '');

  return (
    <div className="my-2 border border-border rounded-md overflow-hidden shadow-sm">
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full px-3 py-2 bg-editor-bg "
      >
        <div className="flex-shrink-0 text-editor-fg opacity-70">
          <TerminalIcon />
        </div>
        <div className="flex-1 text-left font-mono truncate text-editor-fg opacity-90 pr-2">
          {command}
        </div>
        <div className="flex-shrink-0 flex items-center gap-2">
          {(isPending || isError) && (
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isPending ? 'bg-warning animate-pulse' : 'bg-error'
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
          <div className="p-3 bg-editor-bg max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
            <pre className="font-mono whitespace-pre-wrap break-all leading-relaxed text-editor-fg min-h-[0.5rem]">
              <div className="mb-1 text-editor-fg opacity-100 font-bold">
                <span className="opacity-50 mr-2 select-none">$</span>
                {command}
              </div>
              {block.entry.result ? (
                String(block.entry.result)
              ) : (
                <span className="opacity-40 italic">
                  {isFinished ? 'Command finished with no output.' : 'Executing...'}
                </span>
              )}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
