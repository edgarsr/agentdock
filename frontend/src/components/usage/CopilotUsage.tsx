import { useAdapterUsage } from '../../hooks/useAdapterUsage';
import { UsageMetricRow } from './shared/UsageMetricRow';
import { clampPercent } from './shared/quotaVisuals';
import { formatResetAt } from './shared/formatResetAt';

const usageLinkClassName = 'text-link hover:underline focus:outline-none focus-visible:rounded-[3px] focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]';

interface CopilotQuotaWindow {
  entitlement?: number;
  remaining?: number;
  percent_remaining?: number;
  unlimited?: boolean;
}

interface CopilotUsageData {
  quota_reset_date?: string;
  quota_reset_date_utc?: string;
  quota_snapshots?: {
    premium_interactions?: CopilotQuotaWindow;
  };
}

const AGENT_ID = 'github-copilot-cli';
const BILLING_URL = 'https://github.com/settings/billing';

export function CopilotUsage() {
  const data = useAdapterUsage(AGENT_ID);
  if (!data) {
    return (
      <div className="text-foreground-secondary">
        Usage quotas: <button type="button" onClick={() => window.__openUrl?.(BILLING_URL)} className={usageLinkClassName}>{BILLING_URL}</button>
      </div>
    );
  }

  let usage: CopilotUsageData | null = null;
  try {
    usage = JSON.parse(data);
  } catch {
    return (
      <div className="text-foreground-secondary">
        Usage quotas: <button type="button" onClick={() => window.__openUrl?.(BILLING_URL)} className={usageLinkClassName}>{BILLING_URL}</button>
      </div>
    );
  }

  const premium = usage?.quota_snapshots?.premium_interactions;
  if (!premium) {
    return (
      <div className="text-foreground-secondary">
        Usage quotas: <button type="button" onClick={() => window.__openUrl?.(BILLING_URL)} className={usageLinkClassName}>{BILLING_URL}</button>
      </div>
    );
  }

  if (premium.unlimited === true) {
    return null;
  }

  const entitlement = typeof premium.entitlement === 'number' ? premium.entitlement : null;
  const remaining = typeof premium.remaining === 'number' ? premium.remaining : null;
  const used = entitlement !== null && remaining !== null ? Math.max(0, entitlement - remaining) : null;
  const percentRemaining = typeof premium.percent_remaining === 'number' ? premium.percent_remaining : null;
  const percentUsed = percentRemaining !== null ? clampPercent(100 - percentRemaining) : null;
  const resetLabel = formatResetAt(usage?.quota_reset_date_utc ?? usage?.quota_reset_date);
  const metaParts = [
    remaining !== null ? `${remaining} left` : null,
    resetLabel ? `Resets: ${resetLabel}` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-y-2">
      <span className="whitespace-nowrap text-foreground-secondary">Usage quotas</span>
      <UsageMetricRow
        label="Premium requests"
        percent={percentUsed}
        valueLabel={used !== null && entitlement !== null ? `${used} / ${entitlement} used` : 'N/A'}
        meta={metaParts.length > 0 ? metaParts.join(' · ') : undefined}
      />
    </div>
  );
}
