import { CSSProperties, KeyboardEvent, ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { focusMenuItem, getMenuItems, moveMenuFocus } from '../tabbar/menuFocus';

/**
 * Marks the chosen item of a menu panel (`group/menu`) as IDE menus do: until the pointer is over another item of the
 * panel. Such panels must not nest, so a submenu's pointer does not clear its menu's choice.
 */
export const chosenMenuItemClassName = `bg-accent text-accent-foreground group-hover/menu:[&:not(:hover)]:bg-transparent
  group-hover/menu:[&:not(:hover)]:text-foreground`;

/** Styled like the chat input dropdowns (`ChatDropdown`); see `popupMenuActions` for `compact`. */
export const popupMenuItemClassName = (compact: boolean, chosen = false) => `my-0.5 flex w-full items-center rounded pl-2
  pr-3 text-left outline-none hover:bg-accent hover:text-accent-foreground
  focus-visible:shadow-[inset_0_0_0_1px_var(--ide-Button-default-focusColor)] ${compact ? 'min-h-[26px]' : 'min-h-8'}
  ${chosen ? chosenMenuItemClassName : 'text-foreground'}`;

export const popupMenuPanelClassName = `z-50 w-max rounded-md border border-border bg-background-secondary px-1 py-0.5
  text-ide-small`;

export interface PopupMenuAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}

/**
 * `PopupMenu` children for a plain list of actions; choosing one closes the menu. `compact` suits menus of row actions:
 * lower items. A function renders its own keyed item, e.g. a `PopupSubmenu`.
 */
export const popupMenuActions = (
  actions: Array<PopupMenuAction | ((close: () => void) => ReactNode)>,
  compact = false
) => (close: () => void) => actions.map((action) => typeof action === 'function' ? action(close) : (
  <button
    key={action.label}
    type="button"
    role="menuitem"
    onClick={() => {
      close();
      action.onClick();
    }}
    className={popupMenuItemClassName(compact)}
  >
    <span className="mr-2 flex">{action.icon}</span>
    <span className="truncate">{action.label}</span>
  </button>
));

export interface PopupMenuTriggerProps {
  ref: RefObject<HTMLButtonElement>;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

/** Gap between the panel and the trigger, and the least distance between the panel and the window's right edge. */
export const PANEL_GAP_PX = 4;
export const WINDOW_EDGE_PX = 8;

/**
 * The panel opens below the trigger (above it with `placement="top"`) at its natural width, from the trigger's left edge
 * to the right, and is shifted left where it would cross the plugin window's right edge. It is portaled to
 * `document.body`, so containers that clip their overflow (the sidebar) do not cut it off.
 */
interface PopupMenuProps {
  renderTrigger: (props: PopupMenuTriggerProps) => ReactNode;
  children: (close: () => void) => ReactNode;
  placement?: 'top' | 'bottom';
  /**
   * The panel is placed next to the trigger instead of portaled, so it scrolls along with it, e.g. in the chat. On
   * opening it takes the other side where only that one has room inside the containers that clip it, and is shifted
   * left from their right edge.
   */
  inline?: boolean;
}

/**
 * The part of the window that all of the element's ancestors clipping their overflow leave visible, without their
 * scrollbars; their scroll padding is covered by overlays, such as the chat input.
 */
export function visibleRect(element: HTMLElement) {
  const visible = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflow === 'visible') continue;
    const rect = parent.getBoundingClientRect();
    const top = rect.top + parent.clientTop;
    const left = rect.left + parent.clientLeft;
    visible.top = Math.max(visible.top, top + (parseFloat(style.scrollPaddingTop) || 0));
    visible.left = Math.max(visible.left, left);
    visible.bottom = Math.min(visible.bottom, top + parent.clientHeight - (parseFloat(style.scrollPaddingBottom) || 0));
    visible.right = Math.min(visible.right, left + parent.clientWidth);
  }
  return visible;
}

export function PopupMenu({ renderTrigger, children, placement = 'bottom', inline = false }: PopupMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Item to focus once the panel opens; -1 is the last. */
  const focusItemRef = useRef<number | null>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);

  // The panel is first rendered transparent (still focusable) at the top left, measured, then placed.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!open || !root || !trigger || !panel) {
      setPosition(null);
      return;
    }
    if (!inline) {
      setPosition({
        top: placement === 'top' ? trigger.top - PANEL_GAP_PX - panel.offsetHeight : trigger.bottom + PANEL_GAP_PX,
        left: Math.max(0, Math.min(trigger.left, window.innerWidth - WINDOW_EDGE_PX - panel.offsetWidth)),
      });
      return;
    }
    // The placement's side unless only the other one has room for the panel.
    const anchor = root.getBoundingClientRect();
    const visible = visibleRect(root);
    const roomAbove = anchor.top - visible.top;
    const roomBelow = visible.bottom - anchor.bottom;
    const [preferred, other] = placement === 'top' ? [roomAbove, roomBelow] : [roomBelow, roomAbove];
    const keepSide = preferred >= PANEL_GAP_PX + panel.offsetHeight || preferred >= other;
    const offset = `calc(100% + ${PANEL_GAP_PX}px)`;
    setPosition({
      ...((placement === 'top') === keepSide ? { bottom: offset } : { top: offset }),
      left: Math.max(
        visible.left - anchor.left,
        Math.min(0, visible.right - WINDOW_EDGE_PX - anchor.left - panel.offsetWidth)
      ),
    });
  }, [open, placement, inline]);

  useEffect(() => {
    if (!open) return;
    if (focusItemRef.current !== null) {
      focusMenuItem(panelRef.current, focusItemRef.current);
      focusItemRef.current = null;
    }
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('pointerdown', closeOutside);
    return () => window.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const close = () => setOpen(false);
  const portal = (panel: ReactNode) => inline ? panel : createPortal(panel, document.body);

  return (
    <div ref={rootRef} className="relative flex min-w-0">
      {renderTrigger({
        ref: triggerRef,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: () => setOpen((current) => !current),
        // As in `ChatDropdown`: keys open the panel and focus its first item, ArrowUp its last; the portaled panel is
        // not next in the tab order, so Tab from the trigger moves into it while it is open.
        onKeyDown: (event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            close();
            return;
          }
          const index = event.key === 'ArrowUp' ? -1
            : ['ArrowDown', 'Enter', ' '].includes(event.key) || (open && event.key === 'Tab' && !event.shiftKey) ? 0
              : null;
          if (index === null) return;
          event.preventDefault();
          if (open) {
            focusMenuItem(panelRef.current, index);
          } else {
            focusItemRef.current = index;
            setOpen(true);
          }
        },
      })}
      {open ? portal(
        <div
          ref={panelRef}
          role="menu"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
              triggerRef.current?.focus();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              moveMenuFocus(panelRef.current, event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Tab') {
              const items = getMenuItems(panelRef.current);
              const next = items.indexOf(document.activeElement as HTMLButtonElement) + (event.shiftKey ? -1 : 1);
              if (next >= 0 && next < items.length) {
                event.preventDefault();
                items[next].focus();
                return;
              }
              // Past the ends focus returns to the trigger; going forward the panel closes and Tab moves on from it.
              triggerRef.current?.focus();
              if (event.shiftKey) {
                event.preventDefault();
              } else {
                close();
              }
            }
          }}
          style={position ?? { top: 0, left: 0, opacity: 0 }}
          className={`${inline ? 'absolute' : 'fixed'} ${popupMenuPanelClassName}`}
        >
          {/* The chosen item unmounts with the panel, so focus returns to the trigger instead of the page start. */}
          {children(() => {
            close();
            triggerRef.current?.focus();
          })}
        </div>
      ) : null}
    </div>
  );
}
