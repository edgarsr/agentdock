import React from 'react';
import { ToolCallEntry } from '../../../types/chat';
import { ActivityTooltip } from './ActivityTooltip';
import { safeParseJson } from '../../../utils/toolCallUtils';

interface Props {
  entry: ToolCallEntry;
  onOpenFile: (path: string, line?: number) => void;
}

const FileIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
    <polyline points="13 2 13 9 20 9"></polyline>
  </svg>
);

function getFileName(path: string): string {
  if (!path) return '';
  return path.split(/[\\/]/).pop() || path;
}

export const ReadActivity: React.FC<Props> = ({ entry, onOpenFile }) => {
  const parsed = safeParseJson(entry.rawJson);

  const location = parsed?.locations?.[0];
  const rawInput = parsed?.rawInput;
  const fileName = getFileName(location?.path);

  const status = (entry.status || '').toLowerCase();
  const hasError = status === 'error' || status === 'failed';

  const cleanTitle = entry.title?.replace(/^"(.*)"$/, '$1') || entry.title;
  if (!location?.path || !fileName) {
    return (
      <div className="flex items-center gap-1.5 py-0.5 min-w-0 w-full">
        <span className="text-[var(--ide-Label-foreground)] opacity-70 flex-shrink-0">
          <FileIcon size={13} />
        </span>
        <span className="text-foreground/60 truncate min-w-0 flex-1 block">{cleanTitle || entry.kind}</span>
        {hasError && (
          <div className="w-1.5 h-1.5 rounded-full bg-error flex-shrink-0" />
        )}
      </div>
    );
  }

  const limit = rawInput?.limit;
  let startLine: number | null = null;
  if (typeof location?.line === 'number') {
    if (location.line !== 0 || (limit !== undefined && limit !== 0)) {
      startLine = location.line;
    }
  }

  const lineRange = startLine !== null
    ? ` L${startLine}${limit ? `-${startLine + limit}` : ''}`
    : '';

  return (
    <ActivityTooltip
      icon={
        <span className="text-[var(--ide-Label-foreground)] opacity-70">
          <FileIcon size={13} />
        </span>
      }
      content={<span>Read {location.path}{lineRange}</span>}
    >
      <button
        onClick={() => onOpenFile(location.path, startLine || undefined)}
        className="text-[var(--ide-Label-foreground)] hover:text-[var(--ide-Link-foreground)] hover:underline transition-colors text-left font-normal truncate min-w-0 flex-1"
      >
        {fileName}{lineRange}
      </button>
      {hasError && (
        <div className="w-1.5 h-1.5 rounded-full bg-error flex-shrink-0 ml-1" />
      )}
    </ActivityTooltip>
  );
};
