import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'install' | 'accentOutline' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

const baseClassName = [
  'inline-flex items-center justify-center gap-[0.5em] whitespace-nowrap select-none',
  'rounded-[4px] border border-[var(--ide-Button-startBorderColor)] leading-none',
  'min-w-[5.35em] px-[1rem] py-[0.5rem]',
  'hover:bg-hover focus:outline-none transition-[filter] duration-150',
  'disabled:cursor-default disabled:pointer-events-none disabled:opacity-100',
  'disabled:border-[var(--ide-Button-disabledBorderColor)] disabled:bg-[var(--ide-Button-disabledBackground)] disabled:text-[var(--ide-Button-disabledText)]',
  'focus:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]'
].join(' ');

const variantClassNames: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-[var(--ide-Button-default-foreground)] hover:!brightness-110',
  secondary: 'bg-secondary text-[var(--ide-Button-foreground)]',
  install: 'text-success border-[#57965c]',
  accentOutline: 'bg-input text-[var(--ide-Hyperlink-linkColor)]',
  danger: [
    'bg-[rgb(196,77,77)] text-[var(--ide-Button-default-foreground)]',
    'border-[rgb(144,53,53)] py-[0.45rem]'
  ].join(' '),
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  children,
  className,
  variant = 'secondary',
  leftIcon,
  rightIcon,
  fullWidth = false,
  type = 'button',
  ...props
}: ButtonProps, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        baseClassName,
        variantClassNames[variant],
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {leftIcon ? <span className="flex h-[1em] w-[1em] items-center justify-center">{leftIcon}</span> : null}
      {children ? <span>{children}</span> : null}
      {rightIcon ? <span className="flex h-[1em] w-[1em] items-center justify-center">{rightIcon}</span> : null}
    </button>
  );
});
