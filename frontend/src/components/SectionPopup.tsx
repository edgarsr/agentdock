import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Tooltip } from './chat/shared/Tooltip';
import { ModalContainerContext } from './ConfirmationModal';
import { iconButtonClassName } from './LayoutControls';
import type { SectionType } from '../types/chat';
import type { NavigationAction } from './tabbar/NavigationActions';
import { rowButtonClassName, sidebarRowClassName } from './tabbar/rows';
import { HistoryGroupNav, type HistoryGroupNavProps } from './history/HistoryGroupNav';

interface SectionPopupProps {
  /** Listed in a sidebar that switches between them. */
  sections: NavigationAction[];
  activeSection: SectionType | null;
  /** The sidebar shows only icons, named in tooltips, and the title bar names the open section. */
  compact: boolean;
  /** No tab bar above the content, so the top gap is the same as the bottom one. */
  sidebarLayout: boolean;
  /** Lists the history groups under "Chat History" once there is one, unless `compact`. */
  historyGroupNav: HistoryGroupNavProps;
  onClose: () => void;
  children: ReactNode;
}

type Offset = { x: number; y: number };

/** Part of the title bar kept inside the plugin window, so the dialog can always be dragged back. */
const VISIBLE_TITLE_PX = 48;

/** Limits the offset so that part of the title bar stays in the plugin window; layout positions ignore the transform. */
const clampOffset = (dialog: HTMLElement | null, { x, y }: Offset): Offset => {
  const area = dialog?.offsetParent;
  if (!dialog || !area) return { x, y };
  return {
    x: Math.min(
      Math.max(x, VISIBLE_TITLE_PX - dialog.offsetWidth - dialog.offsetLeft),
      area.clientWidth - VISIBLE_TITLE_PX - dialog.offsetLeft,
    ),
    y: Math.min(Math.max(y, -dialog.offsetTop), area.clientHeight - VISIBLE_TITLE_PX - dialog.offsetTop),
  };
};

/**
 * Dialog over the plugin window, as wide as the window allows up to 900px. Its height follows the content, at least
 * 650px where the window allows, and its top edge is fixed, so the title bar does not move when the content changes.
 * The full-width title bar shows the plugin icon and version, as the IDE dialogs show theirs, and a sidebar under it
 * switches between the sections. The title bar drags the dialog, partly out of the plugin window too; it opens at
 * its initial position and keeps the dragged one while switching sections. What lies around it stays usable: a press
 * outside it closes it and still acts there, except on `[data-section-opener]` controls, which switch the section
 * instead; Esc inside it closes it too. Row menus portaled out of it count as inside. It stays mounted while closed so cached sections keep their state.
 */
export function SectionPopup({ sections, activeSection, compact, sidebarLayout, historyGroupNav, onClose, children }: SectionPopupProps) {
  const [dialog, setDialog] = useState<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const open = activeSection !== null;
  const action = sections.find((section) => section.type === activeSection);
  const label = action?.label;

  // Once the section has rendered, so the arrow keys scroll it, unless it has focused one of its controls.
  const focusSection = () => requestAnimationFrame(() => {
    const content = contentRef.current;
    if (!content || content.contains(document.activeElement)) return;
    const scroller = Array.from(content.querySelectorAll<HTMLElement>('[data-section-scroll]'))
      .find((element) => element.offsetParent !== null);
    (scroller ?? dialog)?.focus({ preventScroll: true });
  });

  useEffect(() => {
    if (!open) return;
    if (!dialog?.contains(document.activeElement)) focusSection();
    // Capture phase, so presses whose handlers stop propagation count too.
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!dialog?.contains(target) && !target.closest('[role=menu], [data-section-opener]')) onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [dialog, open, onClose]);

  // Reset while hidden, so reopening does not show the dialog jump from the dragged position.
  useEffect(() => {
    if (!open) setOffset({ x: 0, y: 0 });
  }, [open]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    const start = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    const header = event.currentTarget;
    const move = (moveEvent: PointerEvent) =>
      setOffset(clampOffset(dialog, { x: moveEvent.clientX - start.x, y: moveEvent.clientY - start.y }));
    header.setPointerCapture(event.pointerId);
    header.addEventListener('pointermove', move);
    header.addEventListener('lostpointercapture', () => header.removeEventListener('pointermove', move), {
      once: true,
    });
  };

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-50 flex items-start justify-center px-4
        ${sidebarLayout ? 'pt-[clamp(1.5rem,10vh,2rem)]' : 'pt-[clamp(1.5rem,10vh,4rem)]'} pb-[clamp(1.5rem,10vh,2rem)]
        ${open ? 'visible' : 'invisible'}`}
    >
      <div
        ref={setDialog}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          onClose();
        }}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="pointer-events-auto grid max-h-full min-h-[min(650px,100%)] w-full max-w-[900px]
          grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]
          overflow-hidden rounded-[8px] border border-border bg-background shadow-popup focus:outline-none"
      >
        <div className="col-span-2 flex h-10 select-none items-center gap-2 pl-4 pr-2" onPointerDown={startDrag}>
          {/* The plugin icon drawn on the 16px pixel grid, so it stays sharp at this size. */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeLinecap="square" className="shrink-0 text-foreground-secondary" aria-hidden="true">
            <path d="M2 0.5H14A1.5 1.5 0 0 1 15.5 2V10A1.5 1.5 0 0 1 14 11.5H10.5L8 14L5.5 11.5H2A1.5 1.5 0 0 1 0.5 10V2A1.5 1.5 0 0 1 2 0.5Z" />
            <polyline points="5.5,4 3.5,6 5.5,8" />
            <line x1="7.5" y1="8" x2="8.5" y2="4" />
            <polyline points="10.5,4 12.5,6 10.5,8" />
          </svg>
          <span className="-translate-y-px truncate text-ide-small text-foreground-secondary">
            v{window.__pluginVersion}{compact && label ? ` – ${label}` : ''}
          </span>
          <Tooltip variant="minimal" placement="bottom" content="Close" className="ml-auto flex">
            <button
              type="button"
              onClick={onClose}
              className={iconButtonClassName}
              aria-label={label ? `Close ${label}` : 'Close'}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <nav
          aria-label="Sections"
          data-section-nav
          className="flex w-max max-w-[240px] flex-col overflow-y-auto border-r border-border px-2 pb-2 pt-3 text-ide-small"
        >
          {sections.map((section) => {
            const active = section.type === activeSection;
            const button = (
              <button
                type="button"
                onClick={() => {
                  section.onClick();
                  focusSection();
                }}
                className={`${rowButtonClassName} ${compact ? 'justify-center' : 'pr-6'}`}
                aria-label={compact ? section.label : undefined}
                aria-current={active ? 'page' : undefined}
              >
                <span className="flex shrink-0">{section.icon}</span>
                {compact ? null : <span className="truncate">{section.label}</span>}
              </button>
            );
            return (
              <Fragment key={section.type}>
                {/* The history is a different kind of section than the ones above it. */}
                {section.type === 'history' ? <div className="mb-1.5 mt-1 h-px shrink-0 bg-border" /> : null}
                {section.type === 'history' && !compact && historyGroupNav.groups.length > 0 ? (
                  <HistoryGroupNav section={section} active={active} {...historyGroupNav} onSelect={(group) => {
                    historyGroupNav.onSelect(group);
                    focusSection();
                  }} />
                ) : (
                  <div className={`${sidebarRowClassName(active)} mb-0.5 h-8 ${compact ? 'w-8' : ''}`}>
                    {compact ? (
                      <Tooltip variant="minimal" placement="right" content={section.label} className="flex flex-1">
                        {button}
                      </Tooltip>
                    ) : button}
                  </div>
                )}
              </Fragment>
            );
          })}
        </nav>
        <div ref={contentRef} className="flex min-h-0 min-w-0 flex-col [container-type:inline-size] [container-name:section]">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Body of a section with its own layer for the dialogs the section opens, stacked over it in the same grid cell: they
 * cover and center in the section content, the popup grows to fit a dialog taller than it, and they are hidden with it.
 */
export function SectionFrame({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const [modalLayer, setModalLayer] = useState<HTMLDivElement | null>(null);
  return (
    <div className={hidden ? 'hidden' : 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]'}>
      <div className="col-start-1 row-start-1 flex min-h-0 flex-col">
        <ModalContainerContext.Provider value={modalLayer}>{children}</ModalContainerContext.Provider>
      </div>
      <div ref={setModalLayer} className="relative z-[100] col-start-1 row-start-1 flex min-h-0 empty:hidden" />
    </div>
  );
}
