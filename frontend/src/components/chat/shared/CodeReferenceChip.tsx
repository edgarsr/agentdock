import React from 'react';
import { Tooltip } from './Tooltip';

interface CodeReferenceChipProps {
  fileName: string;
  path: string;
  startLine?: number;
  endLine?: number;
  onClick?: () => void;
  onRemove?: (e: React.MouseEvent) => void;
  flushLeft?: boolean;
  showTooltip?: boolean;
  className?: string;
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
  flushLeft = false,
  showTooltip = true,
  className = '',
}: CodeReferenceChipProps) {
  const lines = formatLines(startLine, endLine);
  const label = lines ? `${fileName}:${lines}` : fileName;
  const tooltipContent = formatTooltip(path, startLine, endLine);

  const chip = (
    <div contentEditable={false}
      className={`group relative inline-flex min-w-0 max-w-[200px] flex-shrink-0 items-center gap-1.5 mb-1 rounded-[4px] 
      border border-border bg-background px-2 py-1 transition-all focus-within:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] 
        ${flushLeft ? 'ml-0 mr-1' : 'mx-1'} ${className}`}
    >
      <button type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        className={`flex min-w-0 items-center gap-1.5 overflow-hidden rounded-sm text-left outline-none transition-colors
          focus-visible:text-foreground ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
        aria-label={`Open reference ${label}`}
      >
        <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center overflow-hidden">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground">
            <path d="M16 18l6-6-6-6"></path>
            <path d="M8 6l-6 6 6 6"></path>
          </svg>
        </span>
        <span className="truncate text-xs font-medium text-foreground">{label}</span>
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 rounded-[4px] p-0.5 text-foreground transition-all hover:bg-background-secondary focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
          title="Delete reference"
          aria-label={`Remove reference ${label}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      )}
    </div>
  );

  if (!showTooltip) return chip;

  return (
    <Tooltip variant="minimal" content={<span className="font-mono">{tooltipContent}</span>}>
      {chip}
    </Tooltip>
  );
}
