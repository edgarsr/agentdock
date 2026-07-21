import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { Checkbox } from '../ui/Checkbox';

interface SettingsToggleCardProps {
  icon?: LucideIcon;
  title: string;
  description: ReactNode;
  enabled: boolean;
  onToggle: () => void;
  ariaLabel: string;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
}

export function SettingsToggleCard({
  icon: _icon,
  title,
  description,
  enabled,
  onToggle,
  ariaLabel,
  disabled = false,
  children,
  className = ''
}: SettingsToggleCardProps) {
  return (
    <div className={`px-2 py-3 text-ide-small ${className}`}>
      <div className='flex flex-col items-stretch gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:gap-4'>
        <Checkbox
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label={ariaLabel}
          disabled={disabled}
          className={`mt-[3px] ${disabled ? 'opacity-50' : ''}`}
        />
        <div className='min-w-0 flex-1'>
          <div className='text-ide-regular text-foreground'>{title}</div>
          {description ? <div className='mt-1 text-foreground-secondary'>{description}</div> : null}
        </div>
      </div>
      {children ? <div className='mt-3 flex flex-col gap-2'>{children}</div> : null}
    </div>
  );
}
