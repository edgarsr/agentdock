import { useAdapterUsage } from '../../../hooks/useAdapterUsage';
import { UsageIcon } from './UsageIcon';
import { ClaudeUsage } from '../ClaudeUsage';

export function ClaudeChatUsage() {
  const data = useAdapterUsage('claude-code');

  let hasData = false;
  let displayPct: number | null = null;

  if (data) {
    try {
      const p = JSON.parse(data);
      if (p && typeof p === 'object') {
        const fiveHour = typeof p.five_hour?.utilization === 'number' ? p.five_hour.utilization : null;
        const sevenDay = typeof p.seven_day?.utilization === 'number' ? p.seven_day.utilization : null;
        const extra = p.extra_usage?.is_enabled && typeof p.extra_usage.utilization === 'number' ? p.extra_usage.utilization : null;

        hasData = !!(p.five_hour || p.seven_day || p.extra_usage?.is_enabled);

        if (sevenDay !== null && sevenDay > 89 && (fiveHour === null || fiveHour < 89)) {
          displayPct = sevenDay;
        } else if (fiveHour !== null) {
          displayPct = fiveHour;
        } else if (sevenDay !== null) {
          displayPct = sevenDay;
        } else if (extra !== null) {
          displayPct = extra;
        }
      }
    } catch {
      hasData = false;
    }
  }

  if (!hasData) return null;

  return (
    <UsageIcon percent={displayPct}>
      <ClaudeUsage stacked />
    </UsageIcon>
  );
}
