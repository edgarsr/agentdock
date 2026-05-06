import React, { useMemo } from 'react';
import { SquareTerminal } from 'lucide-react';
import { ToolCallEntry } from '../../../types/chat';
import { parseToolStatus, safeParseJson } from '../../../utils/toolCallUtils';
import { Tooltip } from '../shared/Tooltip';

interface Props {
  entry: ToolCallEntry;
  isActivePrompt?: boolean;
}

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

function commandFromEntry(entry: ToolCallEntry): string {
  const json = safeParseJson(entry.rawJson);
  const rawOutput = json.rawOutput || {};
  const parsedCommand = Array.isArray(rawOutput.parsed_cmd) ? rawOutput.parsed_cmd[0] : rawOutput.parsed_cmd;
  const parsedCommandText = pickLastString(parsedCommand?.cmd);
  if (parsedCommandText) return parsedCommandText;

  const inputCommand = pickLastString(json.rawInput?.command);
  if (inputCommand) return inputCommand;

  return String(entry.title || 'Terminal Command').replace(/^`|`$/g, '');
}

export const ExecuteActivity: React.FC<Props> = ({ entry, isActivePrompt = false }) => {
  const { isPending, isError } = parseToolStatus(entry.status);
  const command = useMemo(() => commandFromEntry(entry), [entry.rawJson, entry.title]);
  const showPending = isPending && isActivePrompt;

  return (
    <Tooltip variant="minimal" content={command}>
      <div className="flex items-center gap-1.5 min-w-0 cursor-help pr-2">
        <SquareTerminal size={13} className="text-foreground-secondary flex-shrink-0 relative" />
        <span className="text-foreground-secondary font-mono truncate min-w-0 flex-1 block">
          {command}
        </span>
        {showPending && (
          <div className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse flex-shrink-0" />
        )}
        {isError && (
          <div className="w-1.5 h-1.5 rounded-full bg-error flex-shrink-0" />
        )}
      </div>
    </Tooltip>
  );
};
