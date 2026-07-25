import { useAdapterUsage } from '../../hooks/useAdapterUsage';
import { UsageMetricRow } from './shared/UsageMetricRow';
import { clampPercent } from './shared/quotaVisuals';
import { formatResetAt, hasDisplayableQuotaReset } from './shared/formatResetAt';

const usageLinkClassName = 'text-link hover:underline focus:outline-none focus-visible:rounded-[3px] focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]';

interface CopilotQuota {
  entitlementRequests?: number;
  usedRequests?: number;
  remainingPercentage?: number;
  resetDate?: string;
  isUnlimitedEntitlement?: boolean;
}

export interface CopilotUsageData {
  quota?: CopilotQuota;
}

const AGENT_ID = 'github-copilot-cli';
const BILLING_URL = 'https://github.com/settings/billing/ai_usage';

export function parseCopilotUsage(data: string | null): CopilotUsageData | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? parsed as CopilotUsageData : null;
  } catch {
    return null;
  }
}

export function copilotPercentUsed(usage: CopilotUsageData | null): number | null {
  const remaining = usage?.quota?.remainingPercentage;
  return typeof remaining === 'number' ? clampPercent(100 - remaining) : null;
}

function formatQuotaAmount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

export function CopilotUsage() {
  const data = useAdapterUsage(AGENT_ID);
  const usage = parseCopilotUsage(data);
  if (!usage) return null;
  const quota = usage?.quota;
  if (!quota) {
    return (
      <div className="text-foreground-secondary">
        Usage quotas: <button type="button" onClick={() => window.__openUrl?.(BILLING_URL)} className={usageLinkClassName}>{BILLING_URL}</button>
      </div>
    );
  }

  const entitlement = typeof quota.entitlementRequests === 'number' ? quota.entitlementRequests : null;
  const used = typeof quota.usedRequests === 'number' ? quota.usedRequests : null;
  const percentUsed = copilotPercentUsed(usage);
  const resetLabel = hasDisplayableQuotaReset(quota.resetDate) ? formatResetAt(quota.resetDate) : null;
  const valueLabel = quota.isUnlimitedEntitlement
    ? 'No limit'
    : used !== null && entitlement !== null
      ? `${formatQuotaAmount(used)} / ${formatQuotaAmount(entitlement)} AIC`
      : 'N/A';

  return (
    <div className="flex flex-col gap-y-2">
      <span className="whitespace-nowrap text-foreground-secondary">Usage quotas</span>
      <UsageMetricRow
        label="Plan"
        percent={percentUsed}
        valueLabel={valueLabel}
        meta={resetLabel ? `Resets: ${resetLabel}` : undefined}
      />
    </div>
  );
}
