import { useAdapterUsage } from '../../../hooks/useAdapterUsage';
import { UsageIcon } from './UsageIcon';
import { CodexUsage } from '../CodexUsage';

export function CodexChatUsage() {
  const data = useAdapterUsage('codex');

  let hasData = false;
  let usageLabel = '';

  if (data) {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && parsed.rate_limit) {
        const primary = parsed.rate_limit.primary_window;
        const secondary = parsed.rate_limit.secondary_window;

        const hasPrimary = primary && typeof primary.used_percent === 'number';
        const hasSecondary = secondary && typeof secondary.used_percent === 'number';
        if (!hasPrimary && !hasSecondary) {
          hasData = false;
        } else {
          hasData = true;
        }

        let percent = hasPrimary ? primary.used_percent : 0;

        if (hasSecondary && secondary.used_percent > 89 && (!hasPrimary || primary.used_percent < 89)) {
          percent = secondary.used_percent;
        }

        if (hasData) {
          usageLabel = `${Math.round(percent)}% used`;
        }
      }
    } catch {
      hasData = false;
    }
  }

  if (!hasData) return null;

  return (
    <UsageIcon label={usageLabel}>
      <CodexUsage />
    </UsageIcon>
  );
}
