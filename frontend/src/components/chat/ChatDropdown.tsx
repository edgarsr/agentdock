import type * as React from 'react';
import { KeyboardEvent, RefObject, useState, useRef, useEffect } from 'react';
import { DropdownOption } from '../../types/chat';
import { Tooltip } from './shared/Tooltip';
import { chosenMenuItemClassName } from '../ui/PopupMenu';

export default function ChatDropdown({
  containerRef,
  value,
  subValue,
  subValues,
  options,
  placeholder,
  menuTitle,
  triggerTooltip,
  disabled,
  direction = 'up',
  customTrigger,
  showSubValueInTrigger = false,
  onChange,
  onSubChange,
  className = '',
}: {
  containerRef: RefObject<HTMLDivElement>;
  value: string;
  subValue?: string;
  subValues?: Record<string, string | undefined>;
  options: DropdownOption[];
  placeholder: string;
  menuTitle?: string;
  triggerTooltip?: string;
  disabled: boolean;
  direction?: 'up' | 'down';
  customTrigger?: React.ReactNode;
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
    minWidth?: number;
    maxWidth?: number;
  }>({ prop: 'top', offset: 0, maxHeight: 150 });
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const subOptionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pointerTypeRef = useRef<string | null>(null);
  const isCompact = () => (containerRef.current?.getBoundingClientRect().width ?? Infinity) <= 600;

  const applySubMenuPosition = (el: Element, popupEl: Element) => {
    const optionRect = el.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();
    const compact = isCompact();
    const spaceUp = (compact ? optionRect.top : optionRect.bottom) - 85; // Buffer for tab bar and window Chrome
    const spaceDown = window.innerHeight - (compact ? optionRect.bottom : optionRect.top) - 20;
    const padding = compact ? 0 : 6; // Accounts for p-1.5 on the absolute container
    const horizontal = {
      minWidth: compact ? popupRect.width : undefined,
      maxWidth: compact ? Math.max(0, window.innerWidth - popupRect.left - 8) : undefined,
    };

    if (direction === 'up') {
      if (spaceUp < 150 && spaceDown > spaceUp) {
        // Fallback to DOWN if severely constrained going UP
        setSubMenuPosition({
          ...horizontal,
          prop: 'top',
          offset: (compact ? optionRect.bottom : optionRect.top) - popupRect.top - padding,
          maxHeight: Math.max(spaceDown + padding, 150)
        });
      } else {
        // Prefer growing UP
        setSubMenuPosition({
          ...horizontal,
          prop: 'bottom',
          offset: popupRect.bottom - (compact ? optionRect.top : optionRect.bottom) - padding,
          maxHeight: Math.max(spaceUp + padding, 150)
        });
      }
    } else {
      if (spaceDown < 150 && spaceUp > spaceDown) {
        // Fallback to UP
        setSubMenuPosition({
          ...horizontal,
          prop: 'bottom',
          offset: popupRect.bottom - (compact ? optionRect.top : optionRect.bottom) - padding,
          maxHeight: Math.max(spaceUp + padding, 150)
        });
      } else {
        // Prefer growing DOWN
        setSubMenuPosition({
          ...horizontal,
          prop: 'top',
          offset: (compact ? optionRect.bottom : optionRect.top) - popupRect.top - padding,
          maxHeight: Math.max(spaceDown + padding, 150)
        });
      }
    }
  };
  
  const selectedOption = options.find((option) => option.id === value);
  const selectedSubValue = subValues?.[value] ?? subValue;
  const selectedSub = selectedOption?.subOptions?.find((sub) => sub.id === selectedSubValue);
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
  
  const selectedText = showSubValueInTrigger
    ? (selectedSub?.label || selectedSubValue || '')
    : (selectedOption?.label || placeholder);

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

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setHoveredOptionId(null);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', updateSize);
    };
  }, [open, direction]);

  const handleTriggerClick = () => {
    setHoveredOptionId(null);
    setOpen((prev) => !prev);
  };

  const focusMainOption = (index: number, direction = 1) => {
    for (let offset = 0; offset < options.length; offset++) {
      const candidate = (index + direction * offset + options.length * 2) % options.length;
      const button = optionButtonRefs.current[candidate];
      if (button?.getClientRects().length) {
        button.focus();
        return;
      }
    }
  };

  const focusSubOption = (index: number) => {
    subOptionButtonRefs.current[index]?.focus();
  };

  const openAndFocus = (mainIndex: number, direction = 1) => {
    setOpen(true);
    setHoveredOptionId(null);
    requestAnimationFrame(() => {
      focusMainOption(mainIndex, direction);
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
      openAndFocus(options.length - 1, -1);
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
      focusMainOption((index - 1 + options.length) % options.length, -1);
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

  const trigger = (
    <button ref={triggerRef} type="button" disabled={disabled} onClick={handleTriggerClick}
      onKeyDown={handleTriggerKeyDown}
      className={`inline-flex max-w-full min-w-0 appearance-none border-0 items-center justify-start gap-1
          h-full py-1 px-1.5 rounded bg-background-secondary text-foreground transition-colors
          disabled:text-foreground-secondary disabled:cursor-not-allowed group disabled:pointer-events-none
          whitespace-nowrap outline-none focus-visible:bg-hover 
          focus-visible:text-foreground focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] 
          ${open ? 'bg-hover' : 'hover:text-foreground hover:bg-hover'}`}
    >
      {customTrigger ? (customTrigger) : (
        <>
          {renderIcon(selectedOption, "w-4 h-4 shrink-0 mr-0.5 opacity-80")}
          <span className="min-w-0 truncate">{selectedText}</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </>
      )}
    </button>
  );

  return (
    <div ref={rootRef} className={`text-ide-small relative inline-flex min-w-0 items-stretch h-full overflow-visible ${className}`}>
      {triggerTooltip ? (
        <Tooltip variant="minimal" content={triggerTooltip} className="flex h-full min-w-0 max-w-full">
          {trigger}
        </Tooltip>
      ) : trigger}

      {open && !disabled && (
        <div ref={popupRef} className={`absolute mb-[4px] z-[100] w-max rounded-md border border-border bg-background-secondary px-1 py-0.5 
          ${direction === 'up' ? 'bottom-full mb-2 left-0' : 'top-full mt-2 left-0'}`}
        >
          <div className="group/menu flex flex-col overflow-y-auto" style={{ maxHeight: dynamicMaxHeight }} onScroll={() => {
              if (hoveredOptionId && popupRef.current) {
                const el = popupRef.current.querySelector(`[data-option-id="${hoveredOptionId}"]`);
                if (el) {
                  applySubMenuPosition(el, popupRef.current);
                }
              }
            }}
          >
            {menuTitle && (
              <div className="flex min-h-7 items-center px-2 text-ide-small text-[var(--ide-Label-disabledForeground)]">
                {menuTitle}
              </div>
            )}
            {options.map((option, index) => (
              <div key={option.id} data-option-id={option.id} className={`relative ${option.className ?? ''}`}
                onPointerEnter={(e) => {
                  if (e.pointerType !== 'mouse' || isCompact()) return;
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
                      onPointerDown={(event) => { pointerTypeRef.current = event.pointerType; }}
                      onPointerCancel={() => { pointerTypeRef.current = null; }}
                      onFocus={(e) => {
                        if (isCompact()
                          || (pointerTypeRef.current && pointerTypeRef.current !== 'mouse')
                          || !e.currentTarget.matches(':focus-visible')) return;
                        setHoveredOptionId(option.id);
                        if (option.subOptions && popupRef.current) {
                          applySubMenuPosition(e.currentTarget.closest('[data-option-id]') as Element, popupRef.current);
                        }
                      }}
                      onKeyDown={(event) => handleMainOptionKeyDown(event, index)}
                      onClick={(event) => {
                        const pointerType = pointerTypeRef.current;
                        pointerTypeRef.current = null;
                        if (option.subOptions) {
                          if (isCompact() || (pointerType && pointerType !== 'mouse')) {
                            const closing = hoveredOptionId === option.id;
                            setHoveredOptionId(closing ? null : option.id);
                            if (!closing && popupRef.current) {
                              applySubMenuPosition(event.currentTarget.closest('[data-option-id]') as Element, popupRef.current);
                            }
                          }
                          return;
                        }
                        onChange(option.id);
                        setOpen(false);
                        setHoveredOptionId(null);
                      }}
                      className={`flex items-center w-full my-0.5 pl-2 pr-3 min-h-8 text-left transition-colors 
                        rounded min-w-[70px] outline-none hover:bg-accent hover:text-accent-foreground
                        focus-visible:shadow-[inset_0_0_0_1px_var(--ide-Button-default-focusColor)]
                        ${option.id === value && !subValue ? chosenMenuItemClassName : 'text-foreground'}`}
                    >
                      {renderIcon(option, "w-4 h-4 mr-2 flex-shrink-0")}
                      {renderOptionText(option)}
                      {option.subOptions && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                             className={`opacity-40 ml-4 transition-transform ${hoveredOptionId === option.id ? 'chat-max-600:-rotate-90' : ''}`}>
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
                  ) : (<div className="w-full flex">{btn}</div>);
                })()}
              </div>
            ))}
          </div>

          {hoveredOption?.subOptions && (
            <div className={`group/menu absolute mb-[4px] left-full z-[101] ml-1 w-max rounded-md border border-border
              bg-background-secondary px-1 py-0.5
              chat-max-600:left-0 chat-max-600:ml-0 chat-max-600:mb-0 ${hoveredOption.className ?? ''}`}
              style={{[subMenuPosition.prop]: subMenuPosition.offset, minWidth: subMenuPosition.minWidth, maxWidth: subMenuPosition.maxWidth}}
            >
              <div className="overflow-y-auto" style={{ maxHeight: subMenuPosition.maxHeight }}>
                {hoveredOption.subOptions.map((sub, index) => {
                  const btn = (
                    <button ref={(element) => {
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
                      className={`flex items-center w-full my-0.5 pl-2 pr-3 min-h-8 text-left transition-colors rounded outline-none hover:bg-accent hover:text-accent-foreground focus-visible:shadow-[inset_0_0_0_1px_var(--ide-Button-default-focusColor)] ${
                        sub.id === (subValues?.[hoveredOption.id] ?? (hoveredOption.id === value ? subValue : undefined)) ? chosenMenuItemClassName : 'text-foreground'
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
                    <div key={sub.id} className="w-full flex">{btn}</div>
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
