import { useAdapterUsage } from '../../../hooks/useAdapterUsage';
import { AntigravityUsage, parseAntigravityQuotaRows } from '../AntigravityUsage';
import { UsageIcon } from './UsageIcon';

export function AntigravityChatUsage() {
  const data = useAdapterUsage('antigravity');
  const rows = parseAntigravityQuotaRows(data);
  if (rows.length === 0) return null;

  return (
    <UsageIcon percent={Math.max(...rows.map((row) => row.percent))}>
      <AntigravityUsage stacked />
    </UsageIcon>
  );
}
