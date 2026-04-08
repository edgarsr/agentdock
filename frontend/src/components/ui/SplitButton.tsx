import { ChevronDown } from 'lucide-react';
import { ButtonHTMLAttributes, ReactNode, useEffect, useRef, useState } from 'react';

interface SplitButtonMenuItem {
  label: ReactNode;
  onClick?: () => void;
}

interface SplitButtonProps {
  label: ReactNode;
  onAction?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
  onToggle?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
  disabled?: boolean;
  menuItems?: SplitButtonMenuItem[];
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

const actionButtonClassName = [
  'inline-flex items-center justify-center whitespace-nowrap select-none',
  'rounded-l-[4px] rounded-r-none bg-transparent px-3.5 py-[6px]',
  'leading-none text-[var(--ide-Button-default-foreground)]',
  'focus:outline-none focus-visible:shadow-none disabled:cursor-default disabled:pointer-events-none',
].join(' ');

const toggleButtonClassName = [
  'relative inline-flex w-7 items-center justify-center',
  'rounded-r-[4px] bg-transparent text-[var(--ide-Button-default-foreground)]',
  'before:absolute before:left-0 before:top-[15%] before:h-[70%] before:w-px before:bg-primary-foreground before:opacity-50',
  'focus:outline-none focus-visible:shadow-none',
  'disabled:cursor-default disabled:pointer-events-none',
].join(' ');

export function SplitButton({
  label,
  onAction,
  onToggle,
  disabled = false,
  menuItems = [],
}: SplitButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasMenu = menuItems.length > 0;

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [menuOpen]);

  return (
    <div ref={rootRef} className="relative inline-flex flex-col items-start hover:!brightness-110">
      <div className="inline-flex overflow-hidden rounded-[4px] border border-[var(--ide-Button-startBorderColor)] bg-primary
        focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_var(--ide-Button-default-focusColor)]">
        <button
          type="button"
          className={actionButtonClassName}
          disabled={disabled}
          onClick={onAction}
        >
          {label}
        </button>
        <button
          type="button"
          className={cx(
            toggleButtonClassName,
            !hasMenu && 'before:hidden'
          )}
          aria-label="Open button menu"
          aria-expanded={hasMenu ? menuOpen : undefined}
          disabled={disabled}
          onClick={(event) => {
            onToggle?.(event);
            if (event.defaultPrevented || !hasMenu) return;
            setMenuOpen((current) => !current);
          }}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {hasMenu && menuOpen ? (
        <div className="absolute left-0 top-[calc(100%+0.5em)] z-20 min-w-full rounded-[6px] border border-[var(--ide-Button-startBorderColor)] p-1.5">
          {menuItems.map((item, index) => (
            <button
              key={index}
              type="button"
              className="flex px-2 py-0.5 w-full items-center rounded-[4px] hover:bg-accent hover:text-[var(--ide-Button-default-foreground)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
              onClick={() => {
                item.onClick?.();
                setMenuOpen(false);
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
