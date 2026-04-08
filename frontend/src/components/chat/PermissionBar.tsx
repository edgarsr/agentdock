import { memo } from 'react';
import { ShieldAlert } from 'lucide-react';
import { PermissionRequest } from '../../types/chat';
import { Button } from '../ui/Button';
import { Tooltip } from './shared/Tooltip';

interface PermissionBarProps {
  request: PermissionRequest;
  onRespond: (decision: string) => void;
}

const PermissionBar = memo(({ request, onRespond }: PermissionBarProps) => {
  return (
    <>
      <div className="border-t border-border w-full text-foreground-secondary text-ide-small" />

      <div className="mx-auto w-full max-w-[1200px] px-5 py-2">
        <div className="flex items-center gap-3 min-w-0 overflow-x-auto">

          <div className="">
            <ShieldAlert size={18} className="text-warning" />
          </div>

          <div className="flex-1 min-w-0">
            <Tooltip content={request.title} variant={"minimal"}>
              <span className="block truncate text-foreground text-ide-small">
                {request.title}
              </span>
            </Tooltip>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {request.options.map((opt, idx) => (
              <Button
                key={opt.optionId}
                type="button"
                onClick={() => onRespond(opt.optionId)}
                variant={idx === 0 ? 'primary' : 'secondary'}
                className="text-ide-small max-w-[20vw] truncate !inline-block"
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
});

export default PermissionBar;
