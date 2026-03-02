import { useState, useRef, useEffect } from 'react';
import { DropdownOption } from '../../types/chat';

export default function ChatDropdown({
  value,
  options,
  placeholder,
  disabled,
  minWidthClass,
  direction = 'up',
  header,
  onChange,
}: {
  value: string;
  options: DropdownOption[];
  placeholder: string;
  disabled: boolean;
  minWidthClass?: string;
  direction?: 'up' | 'down';
  header?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.id === value);
  const selectedLabel = selectedOption?.label || placeholder;

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, []);

  return (
    <div ref={rootRef} className={`relative inline-flex items-center ${minWidthClass}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 py-1 px-2 rounded  text-foreground/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
      >
        <span className="truncate max-w-[150px]">{selectedLabel}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`opacity-50 group-hover:opacity-100 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {open && !disabled && (
        <div
          className={`absolute z-50 min-w-[220px] rounded-md border border-border bg-background-secondary shadow-xl overflow-hidden py-1 ${
            direction === 'up' ? 'bottom-full mb-2 left-0' : 'top-full mt-2 left-0'
          }`}
        >
          {header && (
            <div className="px-3 py-1.5 font-medium text-foreground/40 border-b border-border/50 text-center uppercase tracking-wider">
              {header}
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            {options.length > 0 ? (
              options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className={`flex items-center w-full px-3 py-1.5 text-left transition-colors  group ${
                    option.id === value ? 'bg-accent text-foreground font-medium' : 'text-foreground/80'
                  }`}
                >
                  <span className="w-5 flex-shrink-0">
                    {option.id === value && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-accent-foreground">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    )}
                  </span>
                  <span className="truncate">{option.label}</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-foreground/40 italic text-center">
                {placeholder}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
