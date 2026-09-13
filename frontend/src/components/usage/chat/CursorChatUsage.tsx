import { useAdapterUsage } from '../../../hooks/useAdapterUsage';
import { CursorUsage, cursorUsagePercents, parseCursorUsage } from '../CursorUsage';
import { UsageIcon } from './UsageIcon';

function usesCursorModelsQuota(modelId?: string): boolean {
  const normalized = modelId?.trim().toLowerCase() ?? '';
  return normalized === 'default' || normalized.includes('composer') || normalized.includes('grok');
}

export function CursorChatUsage({ modelId }: { modelId?: string }) {
  const data = useAdapterUsage('cursor-cli');
  const usage = parseCursorUsage(data);
  if (!usage || usage.isUnlimited) return null;

  const { cursorModels, otherModels } = cursorUsagePercents(usage);
  const percent = usesCursorModelsQuota(modelId) ? cursorModels : otherModels;
  if (percent === null) return null;

  return (
    <UsageIcon adapterId="cursor-cli" percent={percent}>
      <CursorUsage stacked />
    </UsageIcon>
  );
}
