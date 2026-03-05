import { memo } from 'react';
import { ShieldAlert } from 'lucide-react';
import { PermissionRequest } from '../../types/chat';
import { Tooltip } from './shared/Tooltip';

interface PermissionBarProps {
  request: PermissionRequest;
  onRespond: (decision: string) => void;
}

const PermissionBar = memo(({ request, onRespond }: PermissionBarProps) => {
  return (
    <>
      <div className="border-t border-border w-full" />

      <div className="px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-2.5">

          <ShieldAlert size={14} className="flex-shrink-0 text-warning" />

          <span className="font-medium text-foreground-secondary flex-shrink-0">
            Permission Request:
          </span>

          <div className="flex-1 min-w-0">
            <Tooltip content={request.title}>
              <span className="font-mono text-foreground opacity-80">
                {request.title}
              </span>
            </Tooltip>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
            {request.options.map((opt, idx) => (
              <button
                key={opt.optionId}
                type="button"
                onClick={() => onRespond(opt.optionId)}
                className={`px-3 py-0.5 rounded transition-colors ${
                  idx === 0
                    ? 'bg-primary text-primary-foreground hover:opacity-90'
                    : 'bg-transparent border border-border text-foreground-secondary hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

        </div>
      </div>
    </>
  );
});

export default PermissionBar;
