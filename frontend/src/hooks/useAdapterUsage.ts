import {createContext, createElement, ReactNode, useContext, useEffect, useRef, useState} from 'react';
import {ACPBridge} from '../utils/bridge';

const PROMPT_USAGE_REFRESH_MS = 30000;

type UsageLifecycleContextValue =
  | {
      mode: 'chat';
      enabled: boolean;
      isSending: boolean;
    }
  | {
      mode: 'provider';
      enabled: boolean;
    }
  | null;

const UsageLifecycleContext = createContext<UsageLifecycleContextValue>(null);

const providerCache: Record<string, string | null> = {};
const chatCache: Record<string, string | null> = {};

const RICH_USAGE_FIELDS = ['five_hour', 'seven_day', 'extra_usage', 'rate_limit', 'quota', 'usage', 'quota_snapshots', 'individualUsage', 'isUnlimited'];

function parseUsageJson(json: string | null | undefined): Record<string, unknown> | null {
  if (!json || !json.trim()) return null;

  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeProviderUsage(json: string | null | undefined): string | null {
  return parseUsageJson(json) ? json || null : null;
}

function normalizeChatUsage(json: string | null | undefined): string | null {
  const parsed = parseUsageJson(json);
  if (!parsed) return null;
  const hasUsage = RICH_USAGE_FIELDS.some((field) => parsed[field] != null);
  return hasUsage ? json || null : null;
}

export function AdapterUsageLifecycleProvider({
  value,
  children,
}: {
  value: UsageLifecycleContextValue;
  children: ReactNode;
}) {
  return createElement(UsageLifecycleContext.Provider, { value }, children);
}

export function useAdapterUsage(adapterId: string) {
  const lifecycle = useContext(UsageLifecycleContext);
  const isChatMode = lifecycle?.mode === 'chat';
  const enabled = lifecycle?.enabled ?? true;
  const isSending = lifecycle?.mode === 'chat' ? lifecycle.isSending : false;
  const cache = isChatMode ? chatCache : providerCache;
  const normalize = isChatMode ? normalizeChatUsage : normalizeProviderUsage;
  const [data, setData] = useState<string | null>(cache[adapterId] || null);
  const wasSendingRef = useRef(isSending);

  useEffect(() => {
    return ACPBridge.onUsageData((e) => {
      if (e.detail.adapterId !== adapterId) return;
      const nextData = normalize(e.detail.json);
      if (nextData === null && !isChatMode && adapterId !== 'cursor-cli') return;
      cache[adapterId] = nextData;
      setData(nextData);
    });
  }, [adapterId, cache, isChatMode, normalize]);

  useEffect(() => {
    setData(cache[adapterId] || null);
  }, [adapterId, cache]);

  // Showing the data refreshes it, unless the backend cache is recent enough for viewing.
  useEffect(() => {
    if (enabled) ACPBridge.fetchAdapterUsage(adapterId, true);
  }, [adapterId, enabled]);

  // A prompt uses up quota, so its adapter is refreshed when it starts, while it runs and once it ends.
  useEffect(() => {
    if (!isSending) return;
    ACPBridge.fetchAdapterUsage(adapterId);
    const intervalId = window.setInterval(() => ACPBridge.fetchAdapterUsage(adapterId), PROMPT_USAGE_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [adapterId, isSending]);

  useEffect(() => {
    if (wasSendingRef.current && !isSending) ACPBridge.fetchAdapterUsage(adapterId);
    wasSendingRef.current = isSending;
  }, [adapterId, isSending]);

  return data;
}
