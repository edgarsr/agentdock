interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'danger' | 'primary' | 'secondary';
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  showCancelButton?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  secondaryActionLabel,
  onSecondaryAction,
  showCancelButton = true,
  onConfirm,
  onCancel
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  const confirmClassName = confirmVariant === 'danger'
    ? 'bg-error text-white border-error hover:opacity-90'
    : confirmVariant === 'primary'
      ? 'bg-primary text-primary-foreground border-primary-border hover:opacity-90 outline outline-1 outline-primary/30 outline-offset-1'
      : 'bg-transparent text-foreground border border-border hover:bg-background-secondary';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-200"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[420px] rounded-md border border-border bg-background-secondary shadow-2xl animate-in zoom-in-95 duration-200 text-foreground flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)' }}
      >
        <div className="flex justify-between items-center px-3 py-2 select-none">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium leading-none">{title}</span>
          </div>
          <button
            onClick={onCancel}
            className="text-foreground-secondary hover:bg-background hover:text-foreground rounded-sm p-0.5 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.14645 4.14645C4.34171 3.95118 4.65829 3.95118 4.85355 4.14645L8 7.29289L11.1464 4.14645C11.3417 3.95118 11.6583 3.95118 11.8536 4.14645C12.0488 4.34171 12.0488 4.65829 11.8536 4.85355L8.70711 8L11.8536 11.1464C12.0488 11.3417 12.0488 11.6583 11.8536 11.8536C11.6583 12.0488 11.3417 12.0488 11.1464 11.8536L8 8.70711L4.85355 11.8536C4.65829 12.0488 4.34171 12.0488 4.14645 11.8536C3.95118 11.6583 3.95118 11.3417 4.14645 11.1464L7.29289 8L4.14645 4.85355C3.95118 4.65829 3.95118 4.34171 4.14645 4.14645Z"/>
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 pb-6 grow flex items-start gap-4">
          <p className="min-w-0 max-w-full overflow-hidden break-words whitespace-pre-wrap text-[14px] leading-snug [overflow-wrap:anywhere]">
            {message}
          </p>
        </div>

        <div className="flex justify-end items-center px-4 py-3 bg-background-secondary border-t border-border">
          <div className="flex items-center gap-2">
            {secondaryActionLabel && onSecondaryAction ? (
              <button
                onClick={onSecondaryAction}
                className="rounded-[4px] border border-border px-4 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-background"
              >
                {secondaryActionLabel}
              </button>
            ) : null}
            {showCancelButton ? (
              <button
                onClick={onCancel}
                className="rounded-[4px] border border-border px-4 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-background"
              >
                {cancelLabel}
              </button>
            ) : null}
            <button
              onClick={onConfirm}
              className={`rounded-[4px] px-5 py-1 text-[13px] font-medium transition-all ${confirmClassName} focus:outline-none focus:ring-2 focus:ring-primary/50`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

