import { useState, useEffect, useRef } from 'react';

/**
 * Manages expand/collapse state for tool call blocks.
 * Starts expanded during live streaming, auto-collapses when finished.
 * Replayed blocks start collapsed.
 */
export function useAutoCollapse(isFinished: boolean, isReplay?: boolean) {
  const [isExpanded, setIsExpanded] = useState(!isReplay && !isFinished);
  const autoCollapsedRef = useRef(false);

  useEffect(() => {
    if (isFinished && !isReplay && !autoCollapsedRef.current) {
      setIsExpanded(false);
      autoCollapsedRef.current = true;
    }
  }, [isFinished, isReplay]);

  const toggle = () => setIsExpanded(v => !v);

  return { isExpanded, toggle };
}
