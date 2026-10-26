import { InputHTMLAttributes } from 'react';

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function Radio({ checked, onCheckedChange, className = '', ...props }: RadioProps) {
  return <span className={`relative inline-flex h-4 w-4 shrink-0 ${className}`}>
    <input {...props} type="radio" checked={checked} onChange={(event) => onCheckedChange?.(event.target.checked)}
      className="peer absolute inset-0 m-0 h-full w-full appearance-none rounded-full border border-radio-border bg-background p-0
        checked:border-transparent checked:bg-primary disabled:border-radio-border disabled:bg-transparent
        focus:shadow-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--ide-Button-default-focusColor)] focus-visible:outline-offset-2" />
    <span aria-hidden="true" className="pointer-events-none absolute inset-[5px] rounded-full bg-primary-foreground opacity-0 peer-checked:opacity-100 peer-disabled:bg-foreground-secondary" />
  </span>;
}
