import { useAdapterUsage } from '../../hooks/useAdapterUsage';
import { UsageMetricRow } from './shared/UsageMetricRow';
import { clampPercent, formatUsagePercent } from './shared/quotaVisuals';
import { formatResetAt } from './shared/formatResetAt';

const usageLinkClassName = 'text-link hover:underline focus:outline-none focus-visible:rounded-[3px] focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]';

interface CodexWindow {
  used_percent: number;
  reset_after_seconds: number;
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
  return window.reset_after_seconds >= 24 * 60 * 60 ? '7 day limit' : '5 hour limit';
}

function labelsForWindows(primaryWindow: CodexWindow | null, secondaryWindow: CodexWindow | null) {
  const primaryLabel = primaryWindow ? labelForWindow(primaryWindow) : null;
  const secondaryBaseLabel = secondaryWindow ? labelForWindow(secondaryWindow) : null;
  const secondaryLabel = primaryLabel && secondaryBaseLabel === primaryLabel
    ? (primaryLabel === '5 hour limit' ? '7 day limit' : '5 hour limit')
    : secondaryBaseLabel;

  return { primaryLabel, secondaryLabel };
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

  const primaryWindow = isCodexWindow(usage?.rate_limit?.primary_window) ? usage.rate_limit!.primary_window : null;
  const secondaryWindow = isCodexWindow(usage?.rate_limit?.secondary_window) ? usage.rate_limit!.secondary_window : null;
  const { primaryLabel, secondaryLabel } = labelsForWindows(primaryWindow, secondaryWindow);

  if (!primaryWindow && !secondaryWindow) {
    if (!usage?.authType) return null;
    const url = usage.authType === 'api_key' ? 'https://platform.openai.com/usage' : 'https://chatgpt.com/codex/settings/usage';
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
        {primaryWindow && primaryLabel && <WindowLine label={primaryLabel} window={primaryWindow} />}
        {secondaryWindow && secondaryLabel && <WindowLine label={secondaryLabel} window={secondaryWindow} />}
      </div>
    </div>
  );
}
