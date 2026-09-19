import type { ReactNode } from 'react';

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-4 px-4 pb-6 pt-[calc(1rem+var(--content-top-inset,0px))]">
      <h2 className="min-w-0 text-ide-h2 font-normal leading-tight">{children}</h2>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
