import React from 'react';
import { Tooltip } from './Tooltip';

interface CodeReferenceChipProps {
  fileName: string;
  path: string;
  startLine?: number;
  endLine?: number;
  onClick?: () => void;
  onRemove?: (e: React.MouseEvent) => void;
}

function hasLines(startLine?: number, endLine?: number): boolean {
  return Number.isInteger(startLine) && Number.isInteger(endLine) && (startLine ?? 0) > 0 && (endLine ?? 0) > 0;
}

function formatLines(startLine?: number, endLine?: number): string {
  if (!hasLines(startLine, endLine)) return '';
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
}

function formatTooltip(path: string, startLine?: number, endLine?: number): string {
  if (!hasLines(startLine, endLine)) return path;
  return startLine === endLine
    ? `${path}: line ${startLine}`
    : `${path}: lines ${startLine}-${endLine}`;
}

export function CodeReferenceChip({
  fileName,
  path,
  startLine,
  endLine,
  onClick,
  onRemove,
}: CodeReferenceChipProps) {
  const lines = formatLines(startLine, endLine);
  const label = lines ? `${fileName}:${lines}` : fileName;
  const tooltipContent = formatTooltip(path, startLine, endLine);

  return (
    <Tooltip variant="minimal" content={<span className="font-mono">{tooltipContent}</span>}>
      <span
        contentEditable={false}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md border border-border align-middle bg-background transition-all group relative top-[-1px]"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
          className={`flex items-center gap-1.5 min-w-0 ${onClick ? 'cursor-pointer hover:opacity-85' : 'cursor-default'}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/80">
            <path d="M16 18l6-6-6-6"></path>
            <path d="M8 6l-6 6 6 6"></path>
          </svg>
          <span className="text-xs font-medium text-foreground">{label}</span>
        </button>

        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-0.5 p-0.5 text-foreground transition-all rounded-full hover:bg-background-secondary"
            title="Delete reference"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        )}
      </span>
    </Tooltip>
  );
}
