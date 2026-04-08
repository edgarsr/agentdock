import { Check } from 'lucide-react';
import { ButtonHTMLAttributes } from 'react';

interface CheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function Checkbox({
  checked,
  onCheckedChange,
  onClick,
  className,
  disabled = false,
  type = 'button',
  ...props
}: CheckboxProps) {
  return (
    <button
      type={type}
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      className={cx(
        'bg-background inline-flex h-4 w-4 items-center justify-center rounded-[3px] border',
        checked
          ? 'border-transparent bg-primary text-[var(--ide-Button-default-foreground)]'
          : 'border-[var(--ide-Button-startBorderColor)] text-transparent',
        'focus:border-[var(--ide-Button-focusedBorderColor)] focus:outline-none focus:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]',
        className
      )}
      onClick={(event) => {
        onClick?.(event);
        if (disabled) return;
        onCheckedChange?.(!checked);
      }}
      {...props}
    >
      {checked ? <Check size={13} strokeWidth={3.25} /> : null}
    </button>
  );
}
