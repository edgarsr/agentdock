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
  placement?: 'top' | 'bottom' | 'right';
  onShow?: () => void;
}

let hideActiveTooltip: (() => void) | undefined;

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
  placement = 'top',
  onShow,
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
        x: placement === 'right' ? rect.right : rect.left + rect.width / 2,
        y: placement === 'right' ? rect.top + rect.height / 2 : placement === 'bottom' ? rect.bottom : rect.top
      });
    }
  };

  React.useLayoutEffect(() => {
    if (visible && tooltipRef.current) {
      const rect = tooltipRef.current.getBoundingClientRect();
      const margin = 12;
      const startOverflow = (placement === 'right' ? rect.top : rect.left) - margin;
      const endOverflow = (placement === 'right' ? rect.bottom - window.innerHeight : rect.right - window.innerWidth) + margin;
      setOffset(startOverflow < 0 ? -startOverflow : endOverflow > 0 ? -endOverflow : 0);
    }
  }, [visible, coords.x, coords.y, placement]);

  const handleMouseEnter = () => {
    clearTimeout(timerRef.current);
    setOffset(0);
    updatePosition();
    timerRef.current = setTimeout(() => {
      if (!triggerRef.current?.matches(':hover')) return;
      onShow?.();
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
    onShow?.();
    setVisible(true);
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (triggerRef.current?.contains(event.relatedTarget as Node | null)) return;
    handleMouseLeave();
  };

  useEffect(() => {
    if (!visible) return;
    hideActiveTooltip?.();
    hideActiveTooltip = handleMouseLeave;
    const handlePointerMove = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node | null)) handleMouseLeave();
    };
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('scroll', handleMouseLeave, true);
    window.addEventListener('blur', handleMouseLeave);
    return () => {
      if (hideActiveTooltip === handleMouseLeave) hideActiveTooltip = undefined;
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('scroll', handleMouseLeave, true);
      window.removeEventListener('blur', handleMouseLeave);
    };
  }, [visible]);

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
          className="fixed z-[9999] w-max pointer-events-none"
          style={{ 
            left: coords.x, 
            top: coords.y,
            transform: placement === 'right'
              ? `translate(6px, calc(-50% + ${offset}px))`
              : placement === 'bottom'
                ? `translate(calc(-50% + ${offset}px), 6px)`
                : `translate(calc(-50% + ${offset}px), calc(-100% - 6px))`,
            animation: 'tooltip-in 250ms ease-out forwards',
          }}
        >
          <div
            className={cx(
              'border border-border ' +
              'bg-background-secondary text-foreground rounded-md',
              variant === 'minimal'
                ? 'max-w-[min(1000px,calc(100vw-16px))] overflow-hidden px-2 py-1 text-xs whitespace-nowrap text-ellipsis'
                : 'max-w-[min(300px,calc(100vw-16px))] p-3 pt-2 text-ide-small whitespace-normal break-words',
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
