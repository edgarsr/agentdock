import { KeyboardEvent, useState, useRef, useEffect } from 'react';
import { DropdownOption } from '../../types/chat';
import { Tooltip } from './shared/Tooltip';

export default function ChatDropdown({
  value,
  subValue,
  options,
  placeholder,
  disabled,
  minWidthClass,
  direction = 'up',
  customTrigger,
  collapsed = false,
  showSubValueInTrigger = false,
  onChange,
  onSubChange,
  className = '',
}: {
  value: string;
  subValue?: string;
  options: DropdownOption[];
  placeholder: string;
  disabled: boolean;
  minWidthClass?: string;
  direction?: 'up' | 'down';
  customTrigger?: React.ReactNode;
  collapsed?: boolean;
  showSubValueInTrigger?: boolean;
  onChange: (value: string) => void;
  onSubChange?: (parentId: string, subId: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hoveredOptionId, setHoveredOptionId] = useState<string | null>(null);
  const [dynamicMaxHeight, setDynamicMaxHeight] = useState<number>(400);
  const [subMenuPosition, setSubMenuPosition] = useState<{
    prop: 'top' | 'bottom';
    offset: number;
    maxHeight: number;
  }>({ prop: 'top', offset: 0, maxHeight: 150 });
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const subOptionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const applySubMenuPosition = (el: Element, popupEl: Element) => {
    const optionRect = el.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();
    const spaceUp = optionRect.bottom - 85; // Buffer for tab bar and window Chrome
    const spaceDown = window.innerHeight - optionRect.top - 20;
    const padding = 6; // Accounts for p-1.5 on the absolute container

    if (direction === 'up') {
      if (spaceUp < 150 && spaceDown > spaceUp) {
        // Fallback to DOWN if severely constrained going UP
        setSubMenuPosition({
          prop: 'top',
          offset: optionRect.top - popupRect.top - padding,
          maxHeight: Math.max(spaceDown + padding, 150)
        });
      } else {
        // Prefer growing UP
        setSubMenuPosition({
          prop: 'bottom',
          offset: popupRect.bottom - optionRect.bottom - padding,
          maxHeight: Math.max(spaceUp + padding, 150)
        });
      }
    } else {
      if (spaceDown < 150 && spaceUp > spaceDown) {
        // Fallback to UP
        setSubMenuPosition({
          prop: 'bottom',
          offset: popupRect.bottom - optionRect.bottom - padding,
          maxHeight: Math.max(spaceUp + padding, 150)
        });
      } else {
        // Prefer growing DOWN
        setSubMenuPosition({
          prop: 'top',
          offset: optionRect.top - popupRect.top - padding,
          maxHeight: Math.max(spaceDown + padding, 150)
        });
      }
    }
  };
  
  const selectedOption = options.find((option) => option.id === value);
  const selectedSub = selectedOption?.subOptions?.find((sub) => sub.id === subValue);
  const hoveredOption = options.find((option) => option.id === hoveredOptionId && option.subOptions?.length);
  const renderIcon = (option?: DropdownOption, className: string = "w-4 h-4") => {
    if (!option) return null;
    const icon = option.icon || option.iconPath;
    if (!icon) return null;
    
    if (typeof icon === 'string') {
      return <img src={icon} className={className} alt="" />;
    }
    return <div className={className}>{icon}</div>;
  };

  const renderOptionText = (option: DropdownOption) => {
    return <span className="flex-1 truncate">{option.label}</span>;
  };
  
  const selectedText = (showSubValueInTrigger ? (selectedSub?.label || subValue) : undefined) || selectedOption?.label || placeholder;

  useEffect(() => {
    const updateSize = () => {
      if (rootRef.current) {
        const rect = rootRef.current.getBoundingClientRect();
        const tabHeight = 85; 
        if (direction === 'up') {
          setDynamicMaxHeight(Math.max(rect.top - tabHeight - 10, 150));
        } else {
          setDynamicMaxHeight(Math.max(window.innerHeight - rect.bottom - 20, 150));
        }
      }
    };

    if (open) {
      updateSize();
      window.addEventListener('resize', updateSize);
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setHoveredOptionId(null);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', updateSize);
    };
  }, [open, direction]);

  const handleTriggerClick = () => {
    setHoveredOptionId(null);
    setOpen((prev) => !prev);
  };

  const focusMainOption = (index: number) => {
    optionButtonRefs.current[index]?.focus();
  };

  const focusSubOption = (index: number) => {
    subOptionButtonRefs.current[index]?.focus();
  };

  const openAndFocus = (mainIndex: number) => {
    setOpen(true);
    setHoveredOptionId(options[mainIndex]?.id ?? null);
    requestAnimationFrame(() => {
      focusMainOption(mainIndex);
    });
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || options.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAndFocus(0);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAndFocus(options.length - 1);
    }
  };

  const handleMainOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const option = options[index];
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusMainOption((index + 1) % options.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusMainOption((index - 1 + options.length) % options.length);
      return;
    }
    if (event.key === 'ArrowRight' && option?.subOptions?.length) {
      event.preventDefault();
      setHoveredOptionId(option.id);
      requestAnimationFrame(() => focusSubOption(0));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setHoveredOptionId(null);
      triggerRef.current?.focus();
    }
  };

  const handleSubOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const subOptions = hoveredOption?.subOptions ?? [];
    if (subOptions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusSubOption((index + 1) % subOptions.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusSubOption((index - 1 + subOptions.length) % subOptions.length);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const hoveredIndex = options.findIndex((option) => option.id === hoveredOptionId);
      if (hoveredIndex >= 0) {
        focusMainOption(hoveredIndex);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setHoveredOptionId(null);
      triggerRef.current?.focus();
    }
  };

  return (
    <div ref={rootRef} className={`text-ide-small relative inline-flex min-w-0 items-stretch h-full overflow-visible ${minWidthClass} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={`inline-flex max-w-full appearance-none border-0 items-center 
          ${collapsed ? 'justify-center gap-0.5' : 'justify-start gap-1 min-w-0'} 
          h-full py-1 px-1.5 rounded bg-editor-bg text-foreground transition-colors 
          disabled:text-foreground-secondary disabled:cursor-not-allowed group disabled:pointer-events-none
          whitespace-nowrap outline-none focus-visible:bg-hover 
          focus-visible:text-foreground focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] 
          ${open ? 'bg-hover' : 'hover:text-foreground hover:bg-hover'}`}
      >
        {customTrigger ? (
          customTrigger
        ) : (
          <>
            {renderIcon(selectedOption, "w-4 h-4 shrink-0")}
            {!collapsed && (
              <span className="min-w-0 max-w-[120px] truncate">
                {selectedText}
              </span>
            )}
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
              className="flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </>
        )}
      </button>

      {open && !disabled && (
        <div
          ref={popupRef}
          className={`absolute mb-[4px] z-[100] w-max rounded-md border border-border bg-background px-1 py-0.5 animate-in fade-in duration-75 ${
            direction === 'up' ? 'bottom-full mb-2 left-0' : 'top-full mt-2 left-0'
          }`}
        >
          <div 
            className="flex flex-col overflow-y-auto"
            style={{ maxHeight: dynamicMaxHeight }}
            onScroll={() => {
              if (hoveredOptionId && popupRef.current) {
                const el = popupRef.current.querySelector(`[data-option-id="${hoveredOptionId}"]`);
                if (el) {
                  applySubMenuPosition(el, popupRef.current);
                }
              }
            }}
          >
            {options.map((option, index) => (
              <div 
                key={option.id} 
                data-option-id={option.id}
                className="relative"
                onMouseEnter={(e) => {
                  setHoveredOptionId(option.id);
                  if (option.subOptions && popupRef.current) {
                    applySubMenuPosition(e.currentTarget, popupRef.current);
                  }
                }}
              >
                {(() => {
                  const btn = (
                    <button
                      ref={(element) => {
                        optionButtonRefs.current[index] = element;
                      }}
                      type="button"
                      onFocus={(e) => {
                        setHoveredOptionId(option.id);
                        if (option.subOptions && popupRef.current) {
                          applySubMenuPosition(e.currentTarget.closest('[data-option-id]') as Element, popupRef.current);
                        }
                      }}
                      onKeyDown={(event) => handleMainOptionKeyDown(event, index)}
                      onClick={() => {
                        if (!option.subOptions) {
                          onChange(option.id);
                          setOpen(false);
                          setHoveredOptionId(null);
                        }
                      }}
                      className={`flex items-center w-full my-0.5 px-2 min-h-8 text-left transition-colors rounded min-w-[70px]
                        outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ide-Button-default-focusColor)] 
                        ${option.id === value && !subValue ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                      }`}
                    >
                      {renderIcon(option, "w-4 h-4 mr-2 flex-shrink-0")}
                      {renderOptionText(option)}
                      {option.subOptions && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                             className="opacity-40 ml-4">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      )}
                    </button>
                  );

                  const hasUniqueDescription = option.description && option.description !== option.label && !option.subOptions;

                  return hasUniqueDescription ? (
                    <Tooltip variant="default" content={option.description} className="w-full flex" delay={300}>
                      {btn}
                    </Tooltip>
                  ) : (
                    <div className="w-full flex">
                      {btn}
                    </div>
                  );
                })()}

              </div>
            ))}
          </div>

          {hoveredOption?.subOptions && (
            <div
              className={`absolute mb-[4px] left-full z-[101] ml-1 w-max rounded-md border border-border bg-background px-1 py-0.5 animate-in fade-in slide-in-from-left-1 duration-75`}
              style={{
                [subMenuPosition.prop]: subMenuPosition.offset,
              }}
            >
              <div 
                className="overflow-y-auto"
                style={{ maxHeight: subMenuPosition.maxHeight }}
              >
                {hoveredOption.subOptions.map((sub, index) => {
                  const btn = (
                    <button
                      ref={(element) => {
                        subOptionButtonRefs.current[index] = element;
                      }}
                      type="button"
                      onKeyDown={(event) => handleSubOptionKeyDown(event, index)}
                      onClick={() => {
                        onChange(hoveredOption.id);
                        onSubChange?.(hoveredOption.id, sub.id);
                        setOpen(false);
                        setHoveredOptionId(null);
                      }}
                      className={`flex items-center w-full my-0.5 px-2 min-h-8 text-left transition-colors rounded outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ide-Button-default-focusColor)] ${
                        hoveredOption.id === value && sub.id === subValue ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                      }`}
                    >
                      {renderIcon(sub, "w-4 h-4 mr-2 flex-shrink-0")}
                      {renderOptionText(sub)}
                    </button>
                  );
                  
                  const hasUniqueDescription = sub.description && sub.description !== sub.label;

                  return hasUniqueDescription ? (
                    <Tooltip key={sub.id} variant="default" content={sub.description} className="w-full flex" delay={300}>
                      {btn}
                    </Tooltip>
                  ) : (
                    <div key={sub.id} className="w-full flex">
                      {btn}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
