import React from 'react';
import { Tooltip } from './Tooltip';

interface CodeReferenceChipProps {
  fileName: string;
  path: string;
  startLine?: number;
  endLine?: number;
  onClick?: () => void;
  onRemove?: (e: React.MouseEvent) => void;
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
  showTooltip = true
}: CodeReferenceChipProps) {
  const lines = formatLines(startLine, endLine);
  const label = lines ? `${fileName}:${lines}` : fileName;
  const tooltipContent = formatTooltip(path, startLine, endLine);

  const chip = (
    <div contentEditable={false}
      className={`code-refrence-chip inline-flex min-h-[22px] items-center gap-1.5 px-2 py-1 rounded-[6px] border bg-background-secondary
        border-[var(--ide-Button-startBorderColor)] mt-[-0.4rem] relative top-[2px] align-middle transition-all group 
        focus-within:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] mx-0.5`}
    >
      <button type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        className={`flex min-w-0 items-center gap-1.5 overflow-hidden rounded-sm text-left outline-none 
          transition-colors focus-visible:text-foreground ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
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
