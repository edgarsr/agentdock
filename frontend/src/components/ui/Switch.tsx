import { ButtonHTMLAttributes } from 'react';

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function Switch({
  checked,
  onCheckedChange,
  onClick,
  className,
  disabled = false,
  type = 'button',
  ...props
}: SwitchProps) {
  return (
    <button
      type={type}
      role='switch'
      aria-checked={checked}
      disabled={disabled}
      className={cx(
        'relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full border border-transparent transition-colors',
        checked ? 'bg-primary' : 'bg-[var(--ide-Button-startBorderColor)]',
        'focus:outline-none focus:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]',
        'disabled:cursor-default disabled:opacity-50',
        className
      )}
      onClick={(event) => {
        onClick?.(event);
        if (disabled) return;
        onCheckedChange?.(!checked);
      }}
      {...props}
    >
      <span
        aria-hidden='true'
        className={cx(
          'pointer-events-none inline-block h-3 w-3 rounded-full bg-[var(--ide-Button-default-foreground)] shadow transition-transform',
          checked ? 'translate-x-3' : 'translate-x-0'
        )}
      />
    </button>
  );
}
