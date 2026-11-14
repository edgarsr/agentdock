import React, { ReactNode } from 'react';
import { Quote } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface ReferenceChipProps {
  icon: ReactNode;
  label: string;
  labelClassName?: string;
  removeLabel: string;
  tooltip?: ReactNode;
  tooltipVariant?: 'default' | 'minimal';
  tooltipClassName?: string;
  onClick?: () => void;
  onRemove?: (e: React.MouseEvent) => void;
  atLineStart?: boolean;
}

function ReferenceChip({
  icon,
  label,
  labelClassName = '',
  removeLabel,
  tooltip,
  tooltipVariant,
  tooltipClassName,
  onClick,
  onRemove,
  atLineStart = false,
}: ReferenceChipProps) {
  // On the outermost element, so that a tooltip wrapper does not shift the chip in the text line.
  const lineAlignClassName = 'reference-chip mt-[-0.4rem] relative top-[2px] align-middle';
  const chip = (
    <div contentEditable={false}
      className={`inline-flex min-h-[22px] items-center gap-1.5 px-2 py-1 rounded-[6px] border bg-background-secondary
        border-border ${tooltip ? '' : lineAlignClassName} transition-all group
        has-[:focus-visible]:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] ${atLineStart ? 'ml-0 mr-0.5' : 'mx-0.5'}`}
    >
      <button type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        className={`flex min-w-0 items-center gap-1.5 overflow-hidden rounded-sm text-left outline-none 
          transition-colors focus-visible:text-foreground ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center overflow-hidden text-foreground">
          {icon}
        </span>
        <span className={`truncate text-xs font-medium text-foreground ${labelClassName}`}>{label}</span>
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 rounded-[4px] p-0.5 text-foreground transition-all hover:bg-background-secondary focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
          aria-label={removeLabel}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      )}
    </div>
  );

  if (!tooltip) return chip;

  // Inline, so that the chip stays in the text flow of a sent message; flex, so that no text line of its own
  // lies around the chip.
  return (
    <Tooltip variant={tooltipVariant} content={tooltip} className={`!inline-flex ${lineAlignClassName}`}
      contentClassName={tooltipClassName}>
      {chip}
    </Tooltip>
  );
}

interface CodeReferenceChipProps {
  fileName: string;
  path: string;
  startLine?: number;
  endLine?: number;
  onClick?: () => void;
  onRemove?: (e: React.MouseEvent) => void;
  showTooltip?: boolean;
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

  return (
    <ReferenceChip
      icon={
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 18l6-6-6-6"></path>
          <path d="M8 6l-6 6 6 6"></path>
        </svg>
      }
      label={label}
      removeLabel={`Remove reference ${label}`}
      tooltip={showTooltip && <span className="font-mono">{formatTooltip(path, startLine, endLine)}</span>}
      tooltipVariant="minimal"
      onClick={onClick}
      onRemove={onRemove}
    />
  );
}

interface ImageChipProps {
  /** The image address, or none while the image is not loaded. */
  src?: string;
  onClick?: () => void;
  onRemove?: (e: React.MouseEvent) => void;
  atLineStart?: boolean;
}

export function ImageChip({ src, onClick, onRemove, atLineStart }: ImageChipProps) {
  return (
    <ReferenceChip
      icon={src ? <img src={src} alt="" className="h-full w-full rounded-sm object-cover" /> : (
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
      )}
      label="Image"
      removeLabel="Remove image"
      onClick={onClick}
      onRemove={onRemove}
      atLineStart={atLineStart}
    />
  );
}

export function QuoteChip({ quote, onRemove }: { quote: string; onRemove?: (e: React.MouseEvent) => void }) {
  return (
    <ReferenceChip
      icon={<Quote size={12} strokeWidth={2.5} aria-hidden="true" />}
      label={quote.replace(/\s+/g, ' ').trim()}
      labelClassName="max-w-[8rem]"
      removeLabel="Remove quote"
      tooltip={<div className="line-clamp-[12] whitespace-pre-wrap">{quote}</div>}
      tooltipClassName="!text-xs"
      onRemove={onRemove}
    />
  );
}
