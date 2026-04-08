import type { ReactNode } from 'react';

import { QuotaMeter } from './QuotaMeter';
import { formatUsagePercent } from './quotaVisuals';

interface UsageMetricRowProps {
  label: string;
  percent: number | null;
  valueLabel?: string;
  meta?: ReactNode;
}

export function UsageMetricRow({
  label,
  percent,
  valueLabel,
  meta,
}: UsageMetricRowProps) {
  const resolvedValue = valueLabel ?? formatUsagePercent(percent);

  return (
    <div className="flex shrink-0 items-center gap-2 text-xs text-foreground">
      <QuotaMeter percent={percent} size={18} className="self-center ml-1 mr-1 mt-[-2px]" />
      <div className="flex flex-col whitespace-nowrap">
        <div className="flex items-baseline gap-x-1 whitespace-nowrap"><span>{label}:</span><span>{resolvedValue}</span></div>
        {meta ? <div className="whitespace-nowrap text-foreground-secondary">{meta}</div> : null}
      </div>
    </div>
  );
}
