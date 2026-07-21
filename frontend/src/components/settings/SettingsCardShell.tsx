import { ReactNode } from 'react';

interface SettingsCardShellProps {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  control?: ReactNode;
  className?: string;
}

export function SettingsCardShell({ title, description, children, control, className = '' }: SettingsCardShellProps) {
  return (
    <div className={`px-2 py-3 text-ide-small ${className}`}>
      <div className='flex flex-col items-stretch gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:gap-4'>
        <div className='min-w-0 flex-1'>
          <div className='text-ide-regular text-foreground'>{title}</div>
          {description ? <div className='mt-1 text-foreground-secondary'>{description}</div> : null}
        </div>
        {control ? (
          <div className='flex min-h-7 shrink-0 items-center self-end min-[480px]:self-auto'>{control}</div>
        ) : null}
      </div>
      {children ? <div className='mt-3 flex flex-col gap-2'>{children}</div> : null}
    </div>
  );
}
