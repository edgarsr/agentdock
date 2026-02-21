interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmationModal({ isOpen, title, message, onConfirm, onCancel }: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-200">
      <div 
        className="w-full max-w-sm bg-surface border border-border rounded-lg shadow-xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
        </div>
        
        <div className="px-5 py-6">
          <p className="text-sm text-foreground/80 leading-relaxed">
            {message}
          </p>
        </div>
        
        <div className="px-5 py-4 bg-surface-hover/30 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs font-medium rounded border border-border hover:bg-surface-hover transition-colors text-foreground/70 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 text-xs font-medium rounded bg-error text-white hover:opacity-90 transition-all shadow-sm"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
