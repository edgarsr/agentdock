import { useAdapterUsage } from '../../hooks/useAdapterUsage';
import { UsageMetricRow } from './shared/UsageMetricRow';
import { formatResetAt, hasDisplayableQuotaReset } from './shared/formatResetAt';
import { clampPercent, formatUsagePercent } from './shared/quotaVisuals';

interface AntigravityBucket {
  name?: string;
  remaining_fraction: number;
  reset_time?: string;
}

interface AntigravityGroup {
  name: string;
  buckets: AntigravityBucket[];
}

interface AntigravityUsageData {
  quota?: {
    groups?: AntigravityGroup[];
  };
}

export interface AntigravityQuotaRow {
  label: string;
  bucketName?: string;
  percent: number;
  resetTime?: string;
}

export function parseAntigravityQuotaRows(json: string | null): AntigravityQuotaRow[] {
  if (!json) return [];

  try {
    const parsed = JSON.parse(json) as AntigravityUsageData;
    if (!Array.isArray(parsed?.quota?.groups)) return [];

    return parsed.quota.groups.flatMap((group) => {
      if (!group || typeof group.name !== 'string' || !Array.isArray(group.buckets)) return [];
      return group.buckets.flatMap((bucket) => {
        if (!bucket || typeof bucket.remaining_fraction !== 'number' || !Number.isFinite(bucket.remaining_fraction)) return [];
        if (bucket.remaining_fraction < 0 || bucket.remaining_fraction > 1) return [];
        if (bucket.reset_time && !hasDisplayableQuotaReset(bucket.reset_time)) return [];
        const percent = clampPercent((1 - bucket.remaining_fraction) * 100);
        if (percent === null) return [];
        return [{
          label: group.name,
          bucketName: typeof bucket.name === 'string' && bucket.name.trim()
            ? bucket.name.replace(/\s+Remaining$/i, '')
            : undefined,
          percent,
          resetTime: bucket.reset_time,
        }];
      });
    });
  } catch {
    return [];
  }
}

function QuotaLine({ row }: { row: AntigravityQuotaRow }) {
  const resetLabel = formatResetAt(row.resetTime);
  const meta = [row.bucketName, resetLabel ? `Resets: ${resetLabel}` : null].filter(Boolean).join(' · ');
  return (
    <UsageMetricRow
      label={row.label}
      percent={row.percent}
      valueLabel={formatUsagePercent(row.percent)}
      meta={meta || undefined}
    />
  );
}

const AGENT_ID = 'antigravity';

export function AntigravityUsage({ stacked = false }: { stacked?: boolean }) {
  const data = useAdapterUsage(AGENT_ID);
  const rows = parseAntigravityQuotaRows(data);
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-y-2">
      <span className="whitespace-nowrap text-foreground-secondary">Usage quotas</span>
      <div className={stacked ? 'flex flex-col gap-y-1.5' : 'flex flex-wrap gap-x-8 gap-y-1.5'}>
        {rows.map((row, index) => <QuotaLine key={`${row.label}-${row.bucketName || index}`} row={row} />)}
      </div>
    </div>
  );
}
