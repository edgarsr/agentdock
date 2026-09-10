import { useAdapterUsage } from '../../../hooks/useAdapterUsage';
import { UsageIcon } from './UsageIcon';
import { ClaudeUsage } from '../ClaudeUsage';
import { hasDisplayableQuotaReset } from '../shared/formatResetAt';

export function ClaudeChatUsage() {
  const data = useAdapterUsage('claude-code');

  let hasData = false;
  let displayPct: number | null = null;

  if (data) {
    try {
      const p = JSON.parse(data);
      if (p && typeof p === 'object') {
        const fiveHour = hasDisplayableQuotaReset(p.five_hour?.resets_at) && typeof p.five_hour?.utilization === 'number'
          ? p.five_hour.utilization
          : null;
        const sevenDay = hasDisplayableQuotaReset(p.seven_day?.resets_at) && typeof p.seven_day?.utilization === 'number'
          ? p.seven_day.utilization
          : null;

        hasData = fiveHour !== null || sevenDay !== null;

        if (sevenDay !== null && sevenDay > 89 && (fiveHour === null || fiveHour < 89)) {
          displayPct = sevenDay;
        } else if (fiveHour !== null) {
          displayPct = fiveHour;
        } else if (sevenDay !== null) {
          displayPct = sevenDay;
        }
      }
    } catch {
      hasData = false;
    }
  }

  if (!hasData) return null;

  return (
    <UsageIcon adapterId="claude-code" percent={displayPct}>
      <ClaudeUsage stacked />
    </UsageIcon>
  );
}
