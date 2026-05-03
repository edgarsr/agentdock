import React, { FocusEvent, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  delay?: number;
  className?: string;
  showOnFocus?: boolean;
  contentClassName?: string;
  variant?: 'default' | 'minimal';
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  delay = 350,
  className,
  showOnFocus = true,
  contentClassName,
  variant = 'default',
}) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = React.useState(0);

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        x: rect.left + rect.width / 2,
        y: rect.top
      });
    }
  };

  React.useLayoutEffect(() => {
    if (visible && tooltipRef.current) {
      const rect = tooltipRef.current.getBoundingClientRect();
      const margin = 12;
      const leftOverflow = rect.left - margin;
      const rightOverflow = rect.right - (window.innerWidth - margin);

      if (leftOverflow < 0) {
        setOffset(Math.abs(leftOverflow));
      } else if (rightOverflow > 0) {
        setOffset(-rightOverflow);
      } else {
        setOffset(0);
      }
    }
  }, [visible, coords.x]);

  const handleMouseEnter = () => {
    setOffset(0);
    updatePosition();
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  };

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!showOnFocus) return;
    const focusedElement = event.target as HTMLElement | null;
    if (focusedElement && !focusedElement.matches(':focus-visible')) {
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setOffset(0);
    updatePosition();
    setVisible(true);
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (triggerRef.current?.contains(event.relatedTarget as Node | null)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div 
      ref={triggerRef}
      className={cx('block w-fit max-w-full align-middle', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {children}
      {visible && content && createPortal(
        <div 
          ref={tooltipRef}
          className="fixed z-[9999] pointer-events-none"
          style={{ 
            left: coords.x, 
            top: coords.y,
            transform: `translate(calc(-50% + ${offset}px), calc(-100% - 6px))`,
            animation: 'tooltip-in 250ms ease-out forwards',
          }}
        >
          <div
            className={cx(
              'max-w-[calc(100vw-16px)] border border-[var(--ide-Button-startBorderColor)] ' +
              'bg-background-secondary text-foreground rounded-md',
              variant === 'minimal'
                ? 'overflow-hidden px-2 py-1 text-xs whitespace-nowrap text-ellipsis'
                : 'max-w-[300px] p-3 pt-2 text-ide-small whitespace-normal break-words',
              contentClassName
            )}
          >
            {content}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
