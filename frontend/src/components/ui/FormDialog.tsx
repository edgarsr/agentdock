import { ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface FormDialogProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function FormDialog({
  isOpen,
  title,
  onClose,
  children,
  footer
}: FormDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    previousFocusedElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const dialog = dialogRef.current;
    if (!dialog) return;

    window.setTimeout(() => {
      const focusTarget = dialog.querySelector<HTMLElement>('[data-autofocus="true"]');
      (focusTarget ?? dialog).focus();
    }, 0);

    return () => {
      previousFocusedElementRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/20 px-3 pb-3 pt-24 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex w-full max-w-[400px] flex-col overflow-hidden rounded-[8px] border border-border
         mx-4 bg-background text-foreground shadow-[0_18px_48px_rgba(0,0,0,0.42)] animate-in zoom-in-95 duration-150`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="flex items-center justify-between px-3 py-2.5">

          <div id={titleId} className="truncate text-foreground">{title}</div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-[4px] p-1 text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
            aria-label="Close dialog"
          >
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-3 py-2">
          {children}
        </div>

        {footer ? (
          <div className="flex items-center justify-end gap-4 px-3 py-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
