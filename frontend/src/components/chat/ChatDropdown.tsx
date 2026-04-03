import { useState, useRef, useEffect } from 'react';
import { DropdownOption } from '../../types/chat';

export default function ChatDropdown({
  value,
  subValue,
  options,
  placeholder,
  disabled,
  minWidthClass,
  direction = 'up',
  onChange,
  onSubChange,
}: {
  value: string;
  subValue?: string;
  options: DropdownOption[];
  placeholder: string;
  disabled: boolean;
  minWidthClass?: string;
  direction?: 'up' | 'down';
  onChange: (value: string) => void;
  onSubChange?: (parentId: string, subId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hoveredOptionId, setHoveredOptionId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  
  const selectedOption = options.find((option) => option.id === value);
  const selectedSub = selectedOption?.subOptions?.find(s => s.id === subValue);
  const hoveredOption = options.find((option) => option.id === hoveredOptionId && option.subOptions?.length);

  const renderIcon = (path?: string, className: string = "w-4 h-4") => {
    if (!path) return null;
    return <img src={path} className={className} alt="" />;
  };

  const renderOptionText = (option: DropdownOption) => {
    if (!option.description) {
      return <span className="flex-1 truncate">{option.label}</span>;
    }

    return (
      <span className="flex-1 min-w-0">
        <span className="block truncate">{option.label}</span>
        <span className="mt-0.5 block truncate text-[11px] leading-[1.2] opacity-70">
          {option.description}
        </span>
      </span>
    );
  };
  
  // Clean label showing Agent Icon and Model
  const selectedLabel = selectedSub ? (
    <div className="flex items-center gap-1.5 min-w-0">
      {renderIcon(selectedOption?.iconPath, "w-4 h-4")}
      <span className="opacity-30 select-none text-[10px]">•</span>
      <span className="truncate">{selectedSub.label}</span>
    </div>
  ) : (
    <div className="flex items-center gap-2 min-w-0">
      {renderIcon(selectedOption?.iconPath, "w-4 h-4")}
      <span className="truncate">{selectedOption?.label || placeholder}</span>
    </div>
  );

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setHoveredOptionId(null);
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
        className="flex items-center gap-1.5 py-1 px-2 rounded text-foreground hover:bg-background transition-colors disabled:opacity-50 disabled:cursor-not-allowed group whitespace-nowrap"
      >
        <span className="truncate max-w-[200px] text-ide-regular">{selectedLabel}</span>
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
          className={`group-hover:text-accent transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {open && !disabled && (
        <div
          className={`absolute z-[100] min-w-[200px] rounded-md border border-border bg-background-secondary py-1 shadow-2xl animate-in fade-in duration-75 ${
            direction === 'up' ? 'bottom-full mb-2 left-0' : 'top-full mt-2 left-0'
          }`}
        >
          <div className="flex max-h-[calc(100vh-7rem)] flex-col overflow-y-auto">
            {options.map((option) => (
              <div 
                key={option.id} 
                className="relative"
                onMouseEnter={() => setHoveredOptionId(option.id)}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!option.subOptions) {
                      onChange(option.id);
                      setOpen(false);
                      setHoveredOptionId(null);
                    }
                  }}
                  className={`flex items-center w-full px-3 py-2 text-left text-ide-regular transition-colors ${
                    option.id === value && !subValue ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  <span className="w-4 flex-shrink-0">
                    {option.id === value && !subValue && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    )}
                  </span>
                  {renderIcon(option.iconPath, "w-4 h-4 mr-2 flex-shrink-0")}
                  {renderOptionText(option)}
                  {option.subOptions && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  )}
                </button>

              </div>
            ))}
          </div>

          {hoveredOption?.subOptions && (
            <div
              className={`absolute left-full z-[101] ml-[-1px] min-w-[180px] rounded-md border border-border bg-background-secondary py-1 shadow-2xl animate-in fade-in slide-in-from-left-1 duration-75 ${
                direction === 'up' ? 'bottom-0' : 'top-0'
              }`}
            >
              <div className="max-h-[calc(100vh-7rem)] overflow-y-auto">
                {hoveredOption.subOptions.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => {
                      onChange(hoveredOption.id);
                      onSubChange?.(hoveredOption.id, sub.id);
                      setOpen(false);
                      setHoveredOptionId(null);
                    }}
                    className={`flex items-center w-full px-3 py-2 text-left text-ide-regular transition-colors ${
                      hoveredOption.id === value && sub.id === subValue ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <span className="w-4 flex-shrink-0">
                      {hoveredOption.id === value && sub.id === subValue && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      )}
                    </span>
                    {renderOptionText(sub)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
