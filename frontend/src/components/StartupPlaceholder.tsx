import { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { LoadingSpinner } from './ui/LoadingSpinner';

const INDICATOR_DELAY_MS = 1000;
const TIMEOUT_MS = 10000;

/**
 * Shown until the settings and the workspace arrive: empty at first, so a usual load does not flash,
 * then a spinner, then an error. An answer that arrives late still shows the UI.
 */
export function StartupPlaceholder() {
  const [phase, setPhase] = useState<'empty' | 'loading' | 'failed'>('empty');

  useEffect(() => {
    const loadingTimer = window.setTimeout(() => setPhase('loading'), INDICATOR_DELAY_MS);
    const failedTimer = window.setTimeout(() => setPhase('failed'), TIMEOUT_MS);
    return () => {
      window.clearTimeout(loadingTimer);
      window.clearTimeout(failedTimer);
    };
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-foreground-secondary">
      {phase === 'loading' && <LoadingSpinner className="w-5 h-5" />}
      {phase === 'failed' && (
        <>
          <span>Could not connect to the IDE</span>
          <Button variant="primary" onClick={() => window.__reloadUi?.()}>Reload</Button>
        </>
      )}
    </div>
  );
}
