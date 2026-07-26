import { ReactNode } from 'react';
import { Checkbox } from '../ui/Checkbox';

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section>
      <div className='mb-3 flex items-center gap-2'>
        <span className='shrink-0 text-foreground'>{title}</span>
        <span className='h-px flex-1 bg-border' />
      </div>
      <div className='flex flex-col gap-4 pl-4'>{children}</div>
    </section>
  );
}

const descriptionClass = 'text-ide-small text-foreground-secondary';
const nestedClass = 'mt-3 flex flex-col gap-4';

interface SettingsFieldProps {
  label: string;
  colon?: boolean;
  description?: ReactNode;
  /** Puts the control on its own line so it can use the full width. */
  stacked?: boolean;
  children: ReactNode;
}

export function SettingsField({ label, colon = false, description, stacked = false, children }: SettingsFieldProps) {
  const labelNode = <span className='shrink-0 text-foreground'>{label}{colon ? ':' : ''}</span>;
  const descriptionNode = description ? <div className={descriptionClass}>{description}</div> : null;
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      {stacked ? (
        <>
          {labelNode}
          {descriptionNode}
          <div className='mt-2'>{children}</div>
        </>
      ) : (
        <>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            {labelNode}
            {children}
          </div>
          {descriptionNode}
        </>
      )}
    </div>
  );
}

interface SettingsCheckboxProps {
  title: string;
  description?: ReactNode;
  checked: boolean;
  onToggle: () => void;
  ariaLabel: string;
  disabled?: boolean;
  children?: ReactNode;
}

export function SettingsCheckbox({
  title,
  description,
  checked,
  onToggle,
  ariaLabel,
  disabled = false,
  children
}: SettingsCheckboxProps) {
  return (
    <div className={disabled ? 'opacity-50' : ''}>
      <div className='flex items-center gap-[6px] text-foreground'>
        <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={ariaLabel} disabled={disabled} />
        <span onClick={() => !disabled && onToggle()}>{title}</span>
      </div>
      {description ? <div className={`pl-[22px] ${descriptionClass}`}>{description}</div> : null}
      {children ? <div className={`${nestedClass} pl-[22px]`}>{children}</div> : null}
    </div>
  );
}
