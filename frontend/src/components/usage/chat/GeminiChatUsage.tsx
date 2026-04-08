import { useState, useEffect, useRef } from 'react';
import { ACPBridge } from '../../../utils/bridge';
import { useAdapterUsage } from '../../../hooks/useAdapterUsage';
import { UsageIcon } from './UsageIcon';
import { GeminiUsage } from '../GeminiUsage';

export function GeminiChatUsage({ modelId }: { modelId?: string }) {
  const data = useAdapterUsage('gemini-cli');
  const [disabledModels, setDisabledModels] = useState<string[] | undefined>();
  const [currentModelId, setCurrentModelId] = useState<string | undefined>();
  const disabledRefs = useRef<string[] | undefined>();
  const modelRef = useRef<string | undefined>();

  const activeModelId = modelId || currentModelId;

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

  let hasData = false;
  
  if (data) {
    try {
      const parsed = JSON.parse(data);
      const buckets = parsed?.quota?.buckets ?? [];
      const validBuckets = buckets.filter((b: any) => 
        !disabledRefs.current?.some(d => d && b.modelId.includes(d))
      );
      hasData = validBuckets.length > 0;
    } catch {
      hasData = false;
    }
  }

  let displayPct: number | null = null;
  if (data) {
    try {
      const p = JSON.parse(data);
      const buckets: any[] = p?.quota?.buckets ?? [];
      
      // Try to find the bucket for the currently selected model (robust matching)
      const activeBucket = activeModelId ? buckets.find(b => {
        const bid = b.modelId.toLowerCase();
        const mid = activeModelId.toLowerCase();
        return bid === mid || bid === mid.replace('gemini-', '') || mid === bid.replace('gemini-', '');
      }) : null;
      
      if (activeBucket && typeof activeBucket.remainingFraction === 'number') {
        displayPct = (1 - activeBucket.remainingFraction) * 100;
      } else {
        // Fallback: max used pct of enabled models
        const vals = buckets
          .filter((b: any) => !disabledRefs.current?.some(d => d && b.modelId.includes(d)))
          .map((b: any) => b.remainingFraction)
          .filter((v: any) => typeof v === 'number')
          .map((v: number) => (1 - v) * 100);
        if (vals.length > 0) displayPct = Math.max(...vals);
      }
    } catch {}
  }

  if (!hasData) return null;

  return (
    <UsageIcon percent={displayPct}>
      <GeminiUsage disabledModels={disabledModels} stacked />
    </UsageIcon>
  );
}
