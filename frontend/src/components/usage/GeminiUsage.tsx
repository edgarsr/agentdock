import { useAdapterUsage } from '../../hooks/useAdapterUsage';
import { UsageMetricRow } from './shared/UsageMetricRow';
import { clampPercent, formatUsagePercent } from './shared/quotaVisuals';
import { formatResetAt, hasDisplayableQuotaReset } from './shared/formatResetAt';

const usageLinkClassName = 'text-link hover:underline focus:outline-none focus-visible:rounded-[3px] focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]';

interface QuotaBucket {
  modelId: string;
  remainingFraction: number | null;
  resetTime: string | null;
}

interface GeminiUsageData {
  quota?: { buckets: QuotaBucket[] };
}

const AGENT_ID = 'gemini-cli';

function matchesModel(bucketModelId: string, modelId: string): boolean {
  if (modelId.toLowerCase().startsWith('auto')) return true;
  const bucket = bucketModelId.toLowerCase();
  const model = modelId.toLowerCase();
  return bucket === model || bucket === model.replace('gemini-', '') || model === bucket.replace('gemini-', '');
}

export function GeminiUsage({
  disabledModels,
  modelId,
  stacked = false,
}: {
  disabledModels?: string[];
  modelId?: string;
  stacked?: boolean;
}) {
  const data = useAdapterUsage(AGENT_ID);

  if (!data) return null;

  let usage: GeminiUsageData | null = null;
  try {
    usage = JSON.parse(data);
  } catch {
    return null;
  }

  const buckets = (usage?.quota?.buckets ?? []).filter(b =>
    !disabledModels?.some(d => d && b.modelId.includes(d)) &&
    hasDisplayableQuotaReset(b.resetTime) &&
    (!modelId || matchesModel(b.modelId, modelId))
  );

  if (buckets.length === 0) return (
    <div className="text-foreground-secondary">
      Usage : <button type="button" onClick={() => window.__openUrl?.('https://console.cloud.google.com')} className={usageLinkClassName}>console.cloud.google.com</button>
    </div>
  );

  return (
    <div className="flex flex-col gap-y-2">
      <span className="whitespace-nowrap text-foreground-secondary">Usage quotas</span>
      <div className={stacked ? 'flex flex-col gap-y-2' : 'flex flex-wrap gap-x-8 gap-y-2'}>
        {buckets.map((bucket, idx) => {
          const percent = typeof bucket.remainingFraction === 'number'
            ? clampPercent((1 - bucket.remainingFraction) * 100)
            : null;
          const resetLabel = formatResetAt(bucket.resetTime);
          return (
            <UsageMetricRow
              key={bucket.modelId || idx}
              label={bucket.modelId.replace('gemini-', '')}
              percent={percent}
              valueLabel={formatUsagePercent(percent, 1)}
              meta={resetLabel ? `Resets: ${resetLabel}` : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
