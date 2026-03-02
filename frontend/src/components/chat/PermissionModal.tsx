import { PermissionRequest } from '../../types/chat';

interface PermissionModalProps {
  request: PermissionRequest;
  onRespond: (decision: string) => void;
}

export default function PermissionModal({ request, onRespond }: PermissionModalProps) {
  return (
    <div className="absolute inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
      <div className="bg-background-secondary text-foreground border border-border rounded shadow-xl max-w-sm w-full animate-in zoom-in-95 duration-100 pointer-events-auto">
        <div className="p-5">
          <div className="flex gap-4 items-start mb-5">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-lg font-bold select-none">
                ?
            </div>
            
            <div className="flex-grow pt-0.5 min-w-0">
              <div className="text-sm font-semibold mb-1">Permission Request</div>
              <div className="max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                <p className="text-sm leading-normal opacity-90 whitespace-pre-wrap break-all">
                  Action: <span className="font-mono break-words">{request.title}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-center gap-2">
            {request.options.map((opt, idx) => (
              <button
                key={opt.optionId}
                onClick={() => onRespond(opt.optionId)}
                className={`px-4 py-1 text-sm rounded border transition-all ${
                  idx === 0 
                    ? "bg-primary text-primary-foreground border-primary-border" 
                    : "bg-secondary text-secondary-foreground border-secondary-border shadow-sm hover:opacity-80"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
