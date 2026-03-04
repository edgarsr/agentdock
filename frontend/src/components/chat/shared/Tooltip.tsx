import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, delay = 300 }) => {
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
    setOffset(0); // Reset offset before showing
    updatePosition();
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
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
      className="block w-fit max-w-full truncate"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {visible && createPortal(
        <div 
          ref={tooltipRef}
          className="fixed z-[9999] pointer-events-none -translate-y-full mb-1 animate-in fade-in zoom-in-95 duration-400 ease-out"
          style={{ 
            left: coords.x, 
            top: coords.y,
            transform: `translateX(calc(-50% + ${offset}px))`,
            maxWidth: 'calc(100vw - 24px)'
          }}
        >
          <div className="bg-background-secondary border border-border text-foreground text-xs px-2 py-1 rounded-sm whitespace-normal break-all">
            {content}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
