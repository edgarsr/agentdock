import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy } from 'lucide-react';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from '../../utils/highlight';
import { sanitizeMarkdownHtml } from '../../utils/sanitizeHtml';
import { Tooltip } from './shared/Tooltip';
import { useShownImages } from './useShownImages';
import '../../styles/markdown.css';

// Configure marked with highlight.js integration
marked.use(
  markedHighlight({
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  })
);

marked.setOptions({
  breaks: true, // Support GFM line breaks
  gfm: true,
});

interface MarkdownMessageProps {
  content: string;
  enableCodeCopy?: boolean;
  // Marks the main message text that the chat search covers.
  searchable?: boolean;
}

/** [shownImages] are the images from other hosts that the user chose to show. */
export function markdownHtml(content: string, shownImages?: ReadonlySet<string>): string {
  try {
    let processed = content;
    const codeBlockMatches = processed.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      processed += '\n```';
    }
    processed = rewriteWindowsMarkdownImageHrefs(processed);
    const parsed = marked.parse(processed);
    return sanitizeMarkdownHtml(typeof parsed === 'string' ? parsed : '', shownImages);
  } catch (e) {
    console.error('[MarkdownMessage] Parse error:', e);
    return sanitizeMarkdownHtml(content, shownImages);
  }
}

const codeBlockClassName = 'markdown-code-block';
const codeCopySlotClassName = 'absolute right-2 top-2 z-10 opacity-0 transition-opacity duration-200 ease-out delay-0 group-hover:opacity-100 group-hover:delay-300 group-focus-within:opacity-100 group-focus-within:delay-0';

/**
 * Minimalist Markdown rendering component for chat messages.
 * Adheres to IDE theme using Tailwind arbitrary variants and CSS variables.
 */
export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, enableCodeCopy = true, searchable = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copySlots, setCopySlots] = useState<HTMLElement[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [shownImages, handleShowImage] = useShownImages();

  const html = useMemo(() => {
    const sanitizedHtml = markdownHtml(content, shownImages);
    return enableCodeCopy ? decorateCodeBlocks(sanitizedHtml) : sanitizedHtml;
  }, [content, enableCodeCopy, shownImages]);

  useEffect(() => {
    if (!enableCodeCopy) {
      setCopySlots([]);
      return;
    }

    const nextSlots = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>('[data-code-copy-slot]') ?? []
    );
    setCopySlots(nextSlots);
  }, [html, enableCodeCopy]);

  useEffect(() => {
    return () => {
      if (copiedResetTimerRef.current) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
    };
  }, []);

  const handleCopyCodeBlock = useCallback(async (slot: HTMLElement, index: number) => {
    const code = slot.closest(`.${codeBlockClassName}`)?.querySelector('pre code')?.textContent;
    if (!code || !navigator.clipboard?.writeText) return;

    try {
      await navigator.clipboard.writeText(code);
      setCopiedIndex(index);
      if (copiedResetTimerRef.current) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
      copiedResetTimerRef.current = window.setTimeout(() => {
        setCopiedIndex(null);
      }, 1400);
    } catch (error) {
      console.warn('[MarkdownMessage] Failed to copy code block:', error);
    }
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        className="markdown-body"
        data-search-text={searchable || undefined}
        onClick={handleShowImage}
        dangerouslySetInnerHTML={{ __html: html as string }}
      />
      {enableCodeCopy && copySlots.map((slot, index) => createPortal(
        <Tooltip key={index} content={copiedIndex === index ? 'Copied' : 'Copy'} variant="minimal">
          <button
            type="button"
            aria-label={copiedIndex === index ? 'Copied code' : 'Copy code'}
            className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-border bg-background
              text-foreground-secondary transition-colors hover:bg-hover hover:text-foreground focus:outline-none"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleCopyCodeBlock(slot, index);
            }}
          >
            {copiedIndex === index ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </Tooltip>,
        slot
      ))}
    </>
  );
};

function rewriteWindowsMarkdownImageHrefs(markdown: string): string {
  const rewritePart = (part: string) => part.replace(
    /!\[([^\]]*)]\((?:<([^>\n]+)>|([^)\s]+))(\s+(?:"[^"]*"|'[^']*'))?\)/g,
    (full, alt: string, bracketHref: string | undefined, plainHref: string | undefined, title = '') => {
      const href = bracketHref ?? plainHref;
      if (!href?.includes('\\')) return full;
      const next = href.replace(/\\/g, '/');
      const dest = bracketHref !== undefined ? `<${next}>` : next;
      return `![${alt}](${dest}${title})`;
    }
  );

  return markdown.split(/(```[\s\S]*?```)/).map((part, index) => (
    index % 2 === 1 ? part : rewritePart(part)
  )).join('');
}

function decorateCodeBlocks(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;

  Array.from(template.content.querySelectorAll('pre')).forEach((pre, index) => {
    if (!pre.querySelector('code') || pre.parentElement?.classList.contains(codeBlockClassName)) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `${codeBlockClassName} group relative my-3`;

    const copySlot = document.createElement('span');
    copySlot.className = codeCopySlotClassName;
    copySlot.setAttribute('data-code-copy-slot', String(index));

    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    wrapper.appendChild(copySlot);
  });

  const container = document.createElement('div');
  container.appendChild(template.content.cloneNode(true));
  return container.innerHTML;
}
