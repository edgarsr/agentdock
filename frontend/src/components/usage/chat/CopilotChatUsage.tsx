import { useAdapterUsage } from '../../../hooks/useAdapterUsage';
import { UsageIcon } from './UsageIcon';
import { CopilotUsage, copilotPercentUsed, parseCopilotUsage } from '../CopilotUsage';

export function CopilotChatUsage() {
  const data = useAdapterUsage('github-copilot-cli');
  const usage = parseCopilotUsage(data);
  if (!usage?.quota || usage.quota.isUnlimitedEntitlement === true) return null;
  const percentUsed = copilotPercentUsed(usage);

  return (
    <UsageIcon percent={percentUsed}>
      <CopilotUsage />
    </UsageIcon>
  );
}
