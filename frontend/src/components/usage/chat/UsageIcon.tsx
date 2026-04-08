import { Tooltip } from '../../chat/shared/Tooltip';
import React from 'react';
import { QuotaMeter } from '../shared/QuotaMeter';

export function UsageIcon({
  children,
  percent,
}: {
  children: React.ReactNode;
  percent?: number | null;
}) {
  if (percent === null || percent === undefined) return null;

  const displayLabel = `${Math.round(percent)}%`;

  return (
    <Tooltip content={children}>
      <button className="flex items-center h-full ml-0.5 gap-1.5 rounded px-1.5 border-0 bg-editor-bg text-ide-small text-foreground transition-colors outline-none cursor-default hover:bg-hover hover:text-foreground focus-visible:bg-hover focus-visible:text-foreground focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]">
        <div className="flex items-center gap-1">
          <QuotaMeter percent={percent} size={12} className="mr-0.5 relative top-[-1px]" />
          <span className="whitespace-nowrap">{displayLabel}</span>
          <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
        </div>
      </button>
    </Tooltip>
  );
}
