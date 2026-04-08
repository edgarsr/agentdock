import { ReactNode } from 'react';

interface SettingsCardShellProps {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  leading?: ReactNode;
  className?: string;
}

export function SettingsCardShell({
  title,
  description,
  children,
  leading,
  className = '',
}: SettingsCardShellProps) {
  return (
    <div className={className}>
      <div className="px-2 py-4 text-ide-small">
        <div className="text-ide-regular text-foreground">{title}</div>
        <div className="mt-2 mb-1 flex items-start gap-3">
          {leading ? <div className="flex shrink-0 items-center justify-center mt-[1px]">{leading}</div> : null}
          <div className="min-w-0 flex-1">
            {description ? <div className="text-foreground-secondary">{description}</div> : ''}
            {children ? <div className="flex flex-col gap-2">{children}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
