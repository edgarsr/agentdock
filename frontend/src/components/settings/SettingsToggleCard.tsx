import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { SettingsCardShell } from './SettingsCardShell';
import { Switch } from '../ui/Switch';

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
    <SettingsCardShell
      title={title}
      description={description}
      className={className}
      control={
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label={ariaLabel}
          disabled={disabled}
          className={disabled ? 'opacity-50' : ''}
        />
      }
    >
      {children}
    </SettingsCardShell>
  );
}
