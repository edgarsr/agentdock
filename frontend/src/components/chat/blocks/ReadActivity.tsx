import React from 'react';
import { ToolCallEntry } from '../../../types/chat';
import { Tooltip } from '../shared/Tooltip';
import { safeParseJson } from '../../../utils/toolCallUtils';
import { chatFocusClassName } from '../shared/focusStyles';

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

  const location = (entry.locations?.[0] ?? parsed?.locations?.[0]) as { path?: string; line?: number } | undefined;
  const rawInput = parsed?.rawInput;
  const filePath = location?.path ?? rawInput?.filePath ?? rawInput?.path;
  const fileName = getFileName(filePath);

  const status = (entry.status || '').toLowerCase();
  const hasError = status === 'error' || status === 'failed';

  const cleanTitle = entry.title?.replace(/^"(.*)"$/, '$1') || entry.title;
  if (!filePath || !fileName) {
    return (
      <div className="flex items-center gap-1.5 py-0.5 min-w-0 w-full">
        <span className=" flex-shrink-0"><FileIcon size={13} /></span>
        <span className="text-foreground truncate min-w-0 flex-1 block">{cleanTitle || entry.kind}</span>
        {hasError && (
          <div className="w-1.5 h-1.5 rounded-full bg-error flex-shrink-0" />
        )}
      </div>
    );
  }

  const limit = rawInput?.limit;
  let startLine: number | null = null;
  let endLine: number | null = null;
  if (typeof location?.line === 'number') {
    if (location.line !== 0 || (limit !== undefined && limit !== 0)) {
      startLine = location.line;
      if (limit) endLine = startLine + limit;
    }
  }
  if (startLine === null && Array.isArray(rawInput?.view_range) && rawInput.view_range.length >= 1) {
    startLine = rawInput.view_range[0] ?? null;
    endLine = rawInput.view_range[1] ?? null;
  }
  if (startLine === null && typeof rawInput?.offset === 'number') {
    startLine = rawInput.offset;
    if (limit) endLine = startLine + limit;
  }

  const lineRange = startLine !== null
    ? ` L${startLine}${endLine !== null ? `-${endLine}` : ''}`
    : '';
  const pattern = typeof rawInput?.pattern === 'string' && rawInput.pattern.trim().length > 0
    ? rawInput.pattern.trim()
    : null;

  return (
    <Tooltip variant="minimal" content={`Read ${filePath}${lineRange}`}>
      <div className="flex items-center gap-1.5 min-w-0 group/activity cursor-help pr-2">
        <div className="flex-shrink-0 transition-opacity">
          <FileIcon size={13} />
        </div>
        <button
          onClick={() => onOpenFile(filePath, startLine || undefined)}
          className={`text-foreground-secondary hover:underline text-left truncate min-w-0 flex-1 ${chatFocusClassName}`}
        >
          Read {fileName}{lineRange}{pattern ? ` | Pattern: ${pattern}` : ''}
        </button>
        {hasError && (
          <div className="w-1.5 h-1.5 rounded-full bg-error flex-shrink-0" />
        )}
      </div>
    </Tooltip>
  );
};
