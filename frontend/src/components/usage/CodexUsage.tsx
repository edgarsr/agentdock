import { useAdapterUsage } from '../../hooks/useAdapterUsage';
import { UsageMetricRow } from './shared/UsageMetricRow';
import { clampPercent, formatUsagePercent } from './shared/quotaVisuals';
import { formatResetAt, hasDisplayableQuotaResetAfterSeconds } from './shared/formatResetAt';

const usageLinkClassName = 'text-link hover:underline focus:outline-none focus-visible:rounded-[3px] ' +
  'focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]';

interface CodexWindow {
  used_percent: number;
  reset_after_seconds: number;
  limit_window_seconds?: number;
}

interface CodexUsageData {
  authType?: 'subscription' | 'api_key';
  rate_limit?: {
    primary_window?: CodexWindow | null;
    secondary_window?: CodexWindow | null;
  } | null;
}

function formatResetAfterSeconds(seconds: number): string {
  if (seconds <= 0) return 'now';
  
  const resetDate = new Date(Date.now() + seconds * 1000);
  return formatResetAt(resetDate.getTime()) ?? 'soon';
}

function WindowLine({ label, window }: { label: string; window: CodexWindow }) {
  const resetLabel = formatResetAfterSeconds(window.reset_after_seconds);
  const percent = clampPercent(window.used_percent);
  return (
    <UsageMetricRow
      label={label}
      percent={percent}
      valueLabel={formatUsagePercent(percent)}
      meta={resetLabel ? `Resets: ${resetLabel}` : undefined}
    />
  );
}

function isCodexWindow(value: unknown): value is CodexWindow {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.used_percent === 'number' && typeof candidate.reset_after_seconds === 'number';
}

function labelForWindow(window: CodexWindow): string {
  const seconds = window.limit_window_seconds;
  if (typeof seconds !== 'number' || seconds <= 0) return 'Limit';
  const hours = Math.round(seconds / 3600);
  return hours >= 24 ? `${Math.round(hours / 24)} day limit` : `${Math.max(hours, 1)} hour limit`;
}

const AGENT_ID = 'codex';

export function CodexUsage({ stacked = false }: { stacked?: boolean }) {
  const data = useAdapterUsage(AGENT_ID);

  let usage: CodexUsageData | null = null;
  try {
    if (data) usage = JSON.parse(data);
  } catch {
    return null;
  }

  const rawPrimaryWindow = usage?.rate_limit?.primary_window;
  const rawSecondaryWindow = usage?.rate_limit?.secondary_window;
  const primaryWindow = isCodexWindow(rawPrimaryWindow) && hasDisplayableQuotaResetAfterSeconds(rawPrimaryWindow.reset_after_seconds)
    ? rawPrimaryWindow
    : null;
  const secondaryWindow = isCodexWindow(rawSecondaryWindow) && hasDisplayableQuotaResetAfterSeconds(rawSecondaryWindow.reset_after_seconds)
    ? rawSecondaryWindow
    : null;

  if (!primaryWindow && !secondaryWindow) {
    if (!usage || !usage.authType) return null;
    const url = usage.authType === 'api_key' ? 'https://platform.openai.com/settings/organization/usage' : 'https://chatgpt.com/codex/settings/usage';
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
        {primaryWindow && <WindowLine label={labelForWindow(primaryWindow)} window={primaryWindow} />}
        {secondaryWindow && <WindowLine label={labelForWindow(secondaryWindow)} window={secondaryWindow} />}
      </div>
    </div>
  );
}
