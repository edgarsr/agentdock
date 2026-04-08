import { useAdapterUsage } from '../../../hooks/useAdapterUsage';
import { UsageIcon } from './UsageIcon';
import { CopilotUsage } from '../CopilotUsage';

export function CopilotChatUsage() {
  const data = useAdapterUsage('github-copilot-cli');

  let hasData = false;
  let percentUsed: number | null = null;

  if (data) {
    try {
      const parsed = JSON.parse(data);
      const premium = parsed?.quota_snapshots?.premium_interactions;
      if (premium) {
        if (premium.unlimited === true) {
          hasData = false;
        } else {
          hasData = true;
          const percentRemaining = typeof premium.percent_remaining === 'number' ? premium.percent_remaining : null;
          percentUsed = percentRemaining !== null ? Math.max(0, 100 - percentRemaining) : null;
        }
      }
    } catch {
      hasData = false;
    }
  }

  if (!hasData) return null;

  return (
    <UsageIcon percent={percentUsed}>
      <CopilotUsage />
    </UsageIcon>
  );
}
