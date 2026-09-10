import { useAdapterUsage } from '../../hooks/useAdapterUsage';
import { UsageMetricRow } from './shared/UsageMetricRow';
import { clampPercent, formatUsagePercent } from './shared/quotaVisuals';
import { formatResetAt, hasDisplayableQuotaReset } from './shared/formatResetAt';

const usageLinkClassName = 'text-link hover:underline focus:outline-none focus-visible:rounded-[3px] focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]';
const AGENT_ID = 'cursor-cli';
const DASHBOARD_URL = 'https://cursor.com/dashboard/spending';

interface CursorPlanUsage {
  autoPercentUsed?: number;
  apiPercentUsed?: number;
}

export interface CursorUsageData {
  billingCycleEnd?: string | null;
  isUnlimited?: boolean;
  individualUsage?: {
    plan?: CursorPlanUsage | null;
  } | null;
}

export function parseCursorUsage(json: string | null): CursorUsageData | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as CursorUsageData;
  } catch {
    return null;
  }
}

export function cursorUsagePercents(usage: CursorUsageData | null) {
  const plan = usage?.individualUsage?.plan;
  const resetOk = !usage?.billingCycleEnd || hasDisplayableQuotaReset(usage.billingCycleEnd);
  return {
    cursorModels: resetOk && typeof plan?.autoPercentUsed === 'number' ? clampPercent(plan.autoPercentUsed) : null,
    otherModels: resetOk && typeof plan?.apiPercentUsed === 'number' ? clampPercent(plan.apiPercentUsed) : null,
  };
}

function DashboardLink() {
  return (
    <button type="button" onClick={() => window.__openUrl?.(DASHBOARD_URL)} className={usageLinkClassName}>
      {DASHBOARD_URL}
    </button>
  );
}

export function CursorUsage({ stacked = false }: { stacked?: boolean }) {
  const data = useAdapterUsage(AGENT_ID);
  const usage = parseCursorUsage(data);
  const { cursorModels, otherModels } = cursorUsagePercents(usage);
  const resetLabel = formatResetAt(usage?.billingCycleEnd);

  if (usage?.isUnlimited || (cursorModels == null && otherModels == null)) {
    return (
      <div className="text-foreground-secondary">
        Usage quotas: <DashboardLink />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-y-2">
      <span className="whitespace-nowrap text-foreground-secondary">Usage quotas</span>
      <div className={stacked ? 'flex flex-col gap-y-1.5' : 'flex flex-wrap gap-x-8 gap-y-1.5'}>
        {cursorModels != null && (
          <UsageMetricRow
            label="Cursor Models"
            percent={cursorModels}
            valueLabel={formatUsagePercent(cursorModels)}
            meta={resetLabel ? `Resets: ${resetLabel}` : undefined}
          />
        )}
        {otherModels != null && (
          <UsageMetricRow
            label="Other Models"
            percent={otherModels}
            valueLabel={formatUsagePercent(otherModels)}
            meta={resetLabel ? `Resets: ${resetLabel}` : undefined}
          />
        )}
      </div>
    </div>
  );
}
