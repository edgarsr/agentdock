import { useAdapterUsage } from '../../hooks/useAdapterUsage';
import { UsageMetricRow } from './shared/UsageMetricRow';
import { clampPercent, formatUsagePercent } from './shared/quotaVisuals';
import { formatResetAt } from './shared/formatResetAt';

const usageLinkClassName = 'text-link hover:underline focus:outline-none focus-visible:rounded-[3px] focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]';

interface UsageWindow {
  utilization: number | null;
  resets_at: string | null;
}

interface ClaudeUsageData {
  authType?: 'subscription' | 'api_key';
  five_hour?: UsageWindow | null;
  seven_day?: UsageWindow | null;
  extra_usage?: { is_enabled: boolean; utilization: number | null } | null;
}

function parseData(json: string): ClaudeUsageData | null {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as ClaudeUsageData;
  } catch {
    return null;
  }
}

function WindowLine({ label, window }: { label: string; window: UsageWindow }) {
  const resetLabel = formatResetAt(window.resets_at);
  const percent = clampPercent(window.utilization);
  return (
    <UsageMetricRow
      label={label}
      percent={percent}
      valueLabel={formatUsagePercent(percent)}
      meta={resetLabel ? `Resets: ${resetLabel}` : undefined}
    />
  );
}

const AGENT_ID = 'claude-code';

export function ClaudeUsage({ stacked = false }: { stacked?: boolean }) {
  const data = useAdapterUsage(AGENT_ID);

  const usage = data ? parseData(data) : null;
  if (!usage) return null;

  const hasUsageData = usage.five_hour || usage.seven_day || usage.extra_usage?.is_enabled;

  if (!hasUsageData) {
    const url = usage.authType === 'api_key' ? 'https://platform.claude.com' : 'https://claude.ai/settings/usage';
    return (
      <div className="text-foreground-secondary">
        Usage quotas: <button type="button" onClick={() => window.__openUrl?.(url)} className={usageLinkClassName}>{url}</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-y-2">
      <span className="whitespace-nowrap text-foreground-secondary">Usage quotas</span>
      <div className={stacked ? 'flex flex-col gap-y-1.5' : 'flex flex-wrap gap-x-8 gap-y-1.5'}>
        {usage.five_hour && <WindowLine label="5 hour limit" window={usage.five_hour} />}
        {usage.seven_day && <WindowLine label="7 day limit" window={usage.seven_day} />}
        {usage.extra_usage?.is_enabled && usage.extra_usage.utilization !== null && (
          <WindowLine label="Extra usage" window={{ utilization: usage.extra_usage.utilization, resets_at: null }} />
        )}
      </div>
    </div>
  );
}
