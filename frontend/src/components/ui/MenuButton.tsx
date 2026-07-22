import { Triangle } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';

import { Button, type ButtonProps } from './Button';

interface MenuButtonItem {
  label: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}

interface MenuButtonProps {
  label: ReactNode;
  items: MenuButtonItem[];
  disabled?: boolean;
  variant?: ButtonProps['variant'];
}

export function MenuButton({ label, items, disabled = false, variant = 'outline' }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('mousedown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('mousedown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button
        variant={variant}
        rightIcon={<Triangle size={8} className="rotate-180 fill-current" />}
        className="!min-w-0 !gap-1 [&>span:last-child]:!w-auto"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        {label}
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.35em)] z-20 w-max min-w-full rounded-[4px]
            border border-[var(--ide-Button-startBorderColor)] bg-background p-1"
        >
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              role="menuitem"
              title={item.title}
              disabled={item.disabled}
              className="flex min-h-8 w-full items-center whitespace-nowrap rounded-[4px] px-2 text-left leading-none
                text-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none
                focus-visible:bg-accent focus-visible:text-accent-foreground
                disabled:cursor-default disabled:text-[var(--ide-Button-disabledText)]
                disabled:hover:bg-transparent disabled:hover:text-[var(--ide-Button-disabledText)]"
              onClick={() => {
                if (item.disabled) return;
                item.onClick?.();
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
