import {createContext, createElement, ReactNode, useContext, useEffect, useRef, useState} from 'react';
import {ACPBridge} from '../utils/bridge';

const USAGE_REFRESH_MS = 60000;

type UsageLifecycleContextValue =
  | {
      mode: 'chat';
      enabled: boolean;
      isSending: boolean;
      sessionKey?: string;
    }
  | {
      mode: 'provider';
      enabled: boolean;
    }
  | null;

const UsageLifecycleContext = createContext<UsageLifecycleContextValue>(null);

const providerCache: Record<string, string | null> = {};
const chatCache: Record<string, string | null> = {};

const RICH_USAGE_FIELDS = ['five_hour', 'seven_day', 'extra_usage', 'rate_limit', 'quota', 'usage', 'quota_snapshots'];

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
  const sessionKey = lifecycle?.mode === 'chat' ? lifecycle.sessionKey ?? '' : '';
  const cache = isChatMode ? chatCache : providerCache;
  const normalize = isChatMode ? normalizeChatUsage : normalizeProviderUsage;
  const [data, setData] = useState<string | null>(cache[adapterId] || null);
  const didInitRef = useRef(false);
  const prevAdapterIdRef = useRef(adapterId);
  const prevSessionKeyRef = useRef(sessionKey);
  const prevEnabledRef = useRef(enabled);
  const prevIsSendingRef = useRef(isSending);

  useEffect(() => {
    return ACPBridge.onUsageData((e) => {
      if (e.detail.adapterId !== adapterId) return;
      const nextData = normalize(e.detail.json);
      if (nextData === null && !isChatMode) return;
      cache[adapterId] = nextData;
      setData(nextData);
    });
  }, [adapterId, cache, isChatMode, normalize]);

  useEffect(() => {
    const fetchUsage = () => {
      ACPBridge.fetchAdapterUsage(adapterId);
    };

    if (!didInitRef.current) {
      didInitRef.current = true;
      prevAdapterIdRef.current = adapterId;
      prevEnabledRef.current = enabled;
      prevSessionKeyRef.current = sessionKey;
      prevIsSendingRef.current = isSending;

      if (enabled) {
        fetchUsage();
      }
      return;
    }

    if (!enabled) {
      prevEnabledRef.current = false;
      prevIsSendingRef.current = isSending;
      prevSessionKeyRef.current = sessionKey;
      return;
    }

    const adapterChanged = prevAdapterIdRef.current !== adapterId;
    const enabledBecameTrue = !prevEnabledRef.current;

    if (adapterChanged) {
      prevAdapterIdRef.current = adapterId;
      if (isChatMode) {
        chatCache[adapterId] = null;
        setData(null);
      } else {
        setData(providerCache[adapterId] || null);
      }
      fetchUsage();
    } else if (enabledBecameTrue) {
      fetchUsage();
    }

    if (isChatMode) {
      const sessionChanged = sessionKey !== '' && prevSessionKeyRef.current !== sessionKey;
      if (sessionChanged && !adapterChanged) {
        fetchUsage();
      }
    }

    prevEnabledRef.current = true;
    prevSessionKeyRef.current = sessionKey;
  }, [adapterId, enabled, isChatMode, isSending, sessionKey]);

  useEffect(() => {
    if (!enabled || (isChatMode && !isSending)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      ACPBridge.fetchAdapterUsage(adapterId);
    }, USAGE_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [adapterId, enabled, isChatMode, isSending]);

  useEffect(() => {
    if (!isChatMode || !enabled) {
      prevIsSendingRef.current = isSending;
      return;
    }

    const wasSending = prevIsSendingRef.current;
    prevIsSendingRef.current = isSending;

    if (wasSending && !isSending) {
      ACPBridge.fetchAdapterUsage(adapterId, true);
    }
  }, [adapterId, enabled, isChatMode, isSending]);

  return data;
}
