import { useState, useEffect, useRef } from 'react';
import { ACPBridge } from '../../../utils/bridge';
import { useAdapterUsage } from '../../../hooks/useAdapterUsage';
import { UsageIcon } from './UsageIcon';
import { GeminiUsage } from '../GeminiUsage';
import { hasDisplayableQuotaReset } from '../shared/formatResetAt';

export function GeminiChatUsage({ modelId }: { modelId?: string }) {
  const data = useAdapterUsage('gemini-cli');
  const [disabledModels, setDisabledModels] = useState<string[] | undefined>();
  const [currentModelId, setCurrentModelId] = useState<string | undefined>();
  const disabledRefs = useRef<string[] | undefined>();
  const modelRef = useRef<string | undefined>();

  const activeModelId = modelId || currentModelId;

  const matchesActiveModel = (bucketModelId: string) => {
    if (!activeModelId) return false;
    if (activeModelId.toLowerCase().startsWith('auto')) return true;
    const bucket = bucketModelId.toLowerCase();
    const model = activeModelId.toLowerCase();
    return bucket === model || bucket === model.replace('gemini-', '') || model === bucket.replace('gemini-', '');
  };

  useEffect(() => {
    const disposeAdapters = ACPBridge.onAdapters((e) => {
      const agents = Array.isArray(e.detail.adapters) ? e.detail.adapters : [];
      const gemini = agents.find((a: any) => a.id === 'gemini-cli');
      disabledRefs.current = gemini?.disabledModels;
      modelRef.current = gemini?.currentModelId;
      setDisabledModels(gemini?.disabledModels);
      setCurrentModelId(gemini?.currentModelId);
    });
    
    // Request adapters initially to set disabledModels
    ACPBridge.requestAdapters();
    
    return () => { 
      disposeAdapters(); 
    };
  }, []);

  let displayPct: number | null = null;

  if (data) {
    try {
      const parsed = JSON.parse(data);
      const buckets: any[] = parsed?.quota?.buckets ?? [];
      const displayBuckets = buckets.filter((b: any) =>
        !disabledRefs.current?.some(d => d && b.modelId.includes(d)) &&
        hasDisplayableQuotaReset(b.resetTime)
      );

      const isAuto = activeModelId?.toLowerCase().startsWith('auto');
      const activeBucket = (activeModelId && !isAuto) ? displayBuckets.find(b => matchesActiveModel(b.modelId)) : null;
      if (activeBucket && typeof activeBucket.remainingFraction === 'number') {
        displayPct = (1 - activeBucket.remainingFraction) * 100;
      } else if (!activeModelId || isAuto) {
        const vals = displayBuckets
          .map((b: any) => b.remainingFraction)
          .filter((v: any) => typeof v === 'number')
          .map((v: number) => (1 - v) * 100);
        if (vals.length > 0) displayPct = Math.max(...vals);
      }
    } catch {}
  }

  if (displayPct === null) return null;

  return (
    <UsageIcon percent={displayPct}>
      <GeminiUsage disabledModels={disabledModels} modelId={activeModelId} stacked />
    </UsageIcon>
  );
}
