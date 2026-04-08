import { Tooltip } from './Tooltip';

interface ContextUsageIndicatorProps {
  used?: number;
  size?: number;
}

function formatCompactTokens(value?: number): string {
  if (value === undefined) return '?';
  if (value < 1000) return value.toLocaleString();
  if (value < 100000) return `${parseFloat((value / 1000).toFixed(1))}k`;
  if (value < 1000000) return `${Math.round(value / 1000)}k`;
  return `${parseFloat((value / 1000000).toFixed(1))}m`;
}

export function ContextUsageIndicator({ used, size }: ContextUsageIndicatorProps) {
  if (used === undefined || size === undefined || size <= 0) return null;

  const percent = (used / size) * 100;
  const percentUsed = Math.max(0, Math.min(100, Math.round(percent)));
  const percentLeft = Math.max(0, 100 - percentUsed);
  
  const r = 5.5;
  const circumference = 2 * Math.PI * r;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  const usedFormatted = formatCompactTokens(used);
  const sizeFormatted = formatCompactTokens(size);

  return (
    <Tooltip 
      content={
        <div className="text-left text-ide-small">
          <div className="text-foreground-secondary mb-2">Context window</div>
          <div className="">
            {percentUsed}% used <span className="text-foreground-secondary">({percentLeft}% left)</span>
          </div>
          <div>
            <span>{usedFormatted} / {sizeFormatted}</span>{' '}
            <span className="text-foreground-secondary">tokens used</span>
          </div>
        </div>
      }
    >
      <button className="flex items-center h-full px-1.5 ml-0.5 appearance-none border-0 bg-editor-bg hover:text-foreground cursor-default transition-colors outline-none rounded hover:bg-hover text-ide-small group focus-visible:bg-hover focus-visible:text-foreground focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]">
        <div className="flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 14 14" className="rotate-[-90deg]">
            <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
            <circle 
              cx="7" 
               cy="7" 
              r={r} 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.5" 
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
            />
          </svg>
          <span className="ml-1 whitespace-nowrap">{percentUsed}%</span>
          <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
        </div>
      </button>
    </Tooltip>
  );
}
