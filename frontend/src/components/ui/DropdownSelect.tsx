import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface DropdownOption {
  label: string;
  value: string;
}

interface DropdownSelectProps {
  value: string;
  options: DropdownOption[];
  onChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function DropdownSelect({
  value,
  options,
  onChange,
  disabled = false,
  className,
  buttonClassName,
  menuClassName,
  optionClassName,
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value]
  );
  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((option) => option.value === selected?.value)),
    [options, selected]
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusTarget = optionRefs.current[selectedIndex] ?? optionRefs.current[0];
    focusTarget?.focus();
  }, [open, selectedIndex]);

  return (
    <div ref={rootRef} className={cx('relative inline-flex min-w-[7.2em]', className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
        className={cx(
          'bg-[var(--ide-List-hoverBackground)] inline-flex w-full items-center justify-between gap-3',
          'rounded-[4px] border border-[var(--ide-Button-startBorderColor)]',
          'px-2 py-0.5 text-left leading-none text-[var(--ide-Button-foreground)]',
          'focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]',
          'disabled:cursor-default disabled:text-[var(--ide-Button-disabledText)]',
          'focus:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]',
          open && 'border-[var(--ide-TextField-focusedBorderColor)] shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]',
          buttonClassName
        )}
      >
        <span className="truncate leading-[1.2]">{selected?.label ?? ''}</span>
        <span className="flex h-[1.5rem] w-[1rem] items-center justify-center text-foreground-secondary">
          <ChevronDown size={14} />
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          className={cx(
            'absolute left-0 top-[calc(100%+0.35em)] z-20 min-w-full w-max overflow-hidden rounded-[4px] ' +
            'border border-[var(--ide-Button-startBorderColor)] bg-background px-1.5 py-0.5',
            menuClassName
          )}
        >
          {options.map((option, index) => {
            const isSelected = option.value === selected?.value;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setOpen(false);
                    buttonRef.current?.focus();
                    return;
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    optionRefs.current[(index + 1) % options.length]?.focus();
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    optionRefs.current[(index - 1 + options.length) % options.length]?.focus();
                  }
                }}
                onClick={() => {
                  onChange?.(option.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                className={cx(
                  'flex w-full items-center whitespace-nowrap rounded-[4px] text-left leading-none my-0.5 px-2 min-h-8',
                  isSelected
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-accent',
                  'focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]',
                  optionClassName
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
