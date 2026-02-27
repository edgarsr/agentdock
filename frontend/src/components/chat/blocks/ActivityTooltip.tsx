import React from 'react';

interface Props {
  content: React.ReactNode;
  icon: React.ReactNode;
  children: React.ReactNode;
}

export const ActivityTooltip: React.FC<Props> = ({ content, icon, children }) => {
  return (
    <div className="flex items-center gap-1.5 py-0.5 min-w-0 w-full group/row hover:z-50 relative">
      <div className="group flex-shrink-0 cursor-help mt-[-2px]">
        {icon}
        {/* Custom Tooltip */}
        <div className="absolute left-0 bottom-full mb-1 hidden group-hover:block z-[100] pointer-events-none max-w-[calc(100%-24px)]">
          <div className="bg-[#2b2d30] border border-[var(--ide-Borders-color)] text-[var(--ide-Label-foreground)] text-[11px] px-2 py-1 rounded shadow-xl whitespace-normal break-all ring-1 ring-black/20">
            {content}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
};


