import React, { useMemo } from 'react';
import { ToolCallBlock } from '../../../types/chat';
import { ChevronRight, SquareTerminal } from 'lucide-react';
import { parseToolStatus } from '../../../utils/toolCallUtils';
import { useAutoCollapse } from '../../../hooks/useAutoCollapse';
import { MarkdownMessage } from '../MarkdownMessage';
import { chatInsetFocusClassName } from '../shared/focusStyles';

const TerminalIcon = () => (<SquareTerminal size={16} className="text-foreground" />);

interface Props {
  block: ToolCallBlock;
  type?: string
  isActivePrompt?: boolean;
}

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function pickLastString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      const item = value[i];
      if (typeof item === 'string' && item.trim()) {
        return item.trim();
      }
    }
  }
  return null;
}

export const ExecuteBlock: React.FC<Props> = ({ block, isActivePrompt = false, type = null }) => {
  const { isPending, isError, isFinished } = parseToolStatus(block.entry.status);
  const showPending = isPending && isActivePrompt;
  const showFinished = isFinished || !showPending;
  const { isExpanded, toggle } = useAutoCollapse();
  const resultText = block.entry.result ? String(block.entry.result) : '';
  const sanitizedResultText = useMemo(
    () => resultText.replace(ANSI_ESCAPE_PATTERN, ''),
    [resultText]
  );
  const isFencedCodeAtStart = sanitizedResultText.startsWith('```');

  const command = useMemo(() => {
    try {
      const json = JSON.parse(block.entry.rawJson || '{}');
      const rawOutput = json.rawOutput || {};
      
      // Use rawOutput.parsed_cmd.cmd if available (check both array/object)
      const pCmd = Array.isArray(rawOutput.parsed_cmd) ? rawOutput.parsed_cmd[0] : rawOutput.parsed_cmd;
      const parsedCmd = pickLastString(pCmd?.cmd);
      if (parsedCmd) return parsedCmd;

      const rawInput = json.rawInput || {};
      const inputCommand = pickLastString(rawInput.command);
      if (inputCommand) return inputCommand;
    } catch (e) {
      // Ignore parse errors, fallback below
    }
    
    const fallback = block.entry.title || 'Terminal Command';
    return String(fallback).replace(/^`|`$/g, '');
  }, [block.entry.rawJson, block.entry.title, block.entry.kind]);

  return (
    <div className={`border border-border rounded-[6px] overflow-hidden 
      ${type === 'single-exploring' ? '-mt-2' : type === 'exploring' ? '' : 'mb-2'}`}>
      <button onClick={toggle} className={`flex items-center gap-2 w-full px-3 h-9 bg-editor-bg ${chatInsetFocusClassName}`}>
        <div className="flex-shrink-0 grayscale"><TerminalIcon /></div>
        <div className="flex-1 text-left font-mono truncate pr-2 text-foreground">{command}</div>
        <div className="flex-shrink-0 flex items-center gap-2">
          {(showPending || isError) && (
            <div className={`w-2.5 h-2.5 rounded-full ${showPending ? 'bg-warning animate-pulse' : 'bg-error'}`}/>
          )}
          <div className={`transition-transform duration-200 text-editor-fg opacity-50 ${isExpanded ? 'rotate-90' : ''}`}>
            <ChevronRight size={14} />
          </div>
        </div>
      </button>

      <div className="grid transition-[grid-template-rows] duration-300 ease-in-out overflow-hidden"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div tabIndex={-1} className="p-3 text-ide-small bg-editor-bg max-h-[350px] overflow-y-auto scrollbar-thin scrollbar-thumb
              border-t border-border scrollbar-track-transparent [&_.markdown-body]:my-0 [&_.markdown-body_pre]:my-0
              [&_.markdown-body_pre]:border-0 [&_.markdown-body_pre]:rounded-none
              [&_.markdown-body_pre]:bg-transparent [&_.markdown-body_pre]:overflow-visible
              [&_.markdown-body_pre_code]:overflow-visible [&_.markdown-body_pre_code]:p-0">
            <div className="text-editor-fg font-mono min-h-[0.5rem]">
              <div className="mb-1 text-editor-fg">
                <span className="text-foreground-secondary mr-1 select-none">$</span>{command}
              </div>
              {block.entry.result ? (
                <div className="mt-4">{isFencedCodeAtStart ? (<MarkdownMessage content={sanitizedResultText} enableCodeCopy={false} />) : (
                    <pre className="whitespace-pre-wrap break-words font-mono text-sm m-0">{sanitizedResultText}</pre>
                  )}
                </div>
              ) : !showFinished ? (<span className="italic">Executing...</span>) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
