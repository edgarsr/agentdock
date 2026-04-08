import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { SettingsCardShell } from './SettingsCardShell';

interface SettingsSelectCardProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsSelectCard({
  icon: _icon,
  title,
  description,
  children,
  className = '',
}: SettingsSelectCardProps) {
  return (
    <SettingsCardShell
      title={title}
      description={description}
      className={className}
    >
      {children}
    </SettingsCardShell>
  );
}
