import { ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section>
      <h2 className='mb-1 px-2 text-xs font-medium text-foreground-secondary'>{title}</h2>
      <div className='divide-y divide-border border-y border-border'>{children}</div>
    </section>
  );
}
