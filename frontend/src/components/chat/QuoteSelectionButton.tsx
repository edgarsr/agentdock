import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Quote } from 'lucide-react';

interface QuoteSelection {
  quote: string;
  left: number;
  top: number;
}

/** Text selected within one block of an assistant response's main text, which the chat search also covers. */
function readQuoteSelection(container: HTMLElement): QuoteSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  let range = selection.getRangeAt(0);
  const start = range.startContainer;
  const source = (start instanceof Element ? start : start.parentElement)?.closest('.markdown-body[data-search-text]');
  if (!source || !container.contains(source)) return null;
  // A triple click on the last paragraph ends the selection in the next element; keep only this block.
  if (!source.contains(range.endContainer)) {
    selection.setBaseAndExtent(start, range.startOffset, source, source.childNodes.length);
    range = selection.getRangeAt(0);
  }

  const quote = selection.toString().trim();
  const end = Array.from(range.getClientRects()).filter((rect) => rect.width > 0).pop();
  return quote && end ? { quote, left: end.right, top: end.bottom + 4 } : null;
}

/** Shows a button below the end of text selected in an assistant response that quotes it in the composer. */
export function QuoteSelectionButton({ containerRef }: { containerRef: RefObject<HTMLDivElement> }) {
  const [selection, setSelection] = useState<QuoteSelection | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // The selection is final once the mouse button or the key is released.
    const update = () => requestAnimationFrame(() => setSelection(readQuoteSelection(container)));
    const hide = (event: Event) => {
      if (!buttonRef.current?.contains(event.target as Node)) setSelection(null);
    };

    document.addEventListener('mouseup', update);
    document.addEventListener('keyup', update);
    document.addEventListener('mousedown', hide);
    container.addEventListener('scroll', hide);
    return () => {
      document.removeEventListener('mouseup', update);
      document.removeEventListener('keyup', update);
      document.removeEventListener('mousedown', hide);
      container.removeEventListener('scroll', hide);
    };
  }, [containerRef]);

  if (!selection) return null;

  const handleQuote = () => {
    window.dispatchEvent(new CustomEvent('external-quote', { detail: { quote: selection.quote } }));
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  return createPortal(
    <button
      ref={buttonRef}
      type="button"
      // Keeps the selection while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={handleQuote}
      className="fixed z-[60] inline-flex -translate-x-full items-center gap-1 rounded-[4px] border border-border
        bg-background-secondary px-2 py-1 text-xs text-foreground hover:bg-hover focus:outline-none"
      style={{ left: selection.left, top: selection.top }}
    >
      <Quote size={12} aria-hidden="true" />
      Quote
    </button>,
    document.body
  );
}
