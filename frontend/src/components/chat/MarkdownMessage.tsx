import React, { useMemo } from 'react';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from '../../utils/highlight';

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
}

/**
 * Minimalist Markdown rendering component for chat messages.
 * Adheres to IDE theme using Tailwind arbitrary variants and CSS variables.
 */
export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  const html = useMemo(() => {
    try {
      // Basic stream safety: close unclosed code blocks
      let processed = content;
      const codeBlockMatches = processed.match(/```/g);
      if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
        processed += '\n```';
      }
      return marked.parse(processed);
    } catch (e) {
      console.error('[MarkdownMessage] Parse error:', e);
      return content;
    }
  }, [content]);

  return (
    <div 
      className="
        my-4
        text-inherit leading-relaxed break-words
        [&_p]:mb-3 [&_p:last-child]:mb-0
        [&_h1]:text-[1.25em] [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:mt-4
        [&_h2]:text-[1.15em] [&_h2]:font-bold [&_h2]:mb-2 [&_h2]:mt-3
        [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3
        [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3
        [&_li]:mb-1
        [&_code]:font-mono [&_code]:text-[0.9em]
        [&_code]:bg-[var(--ide-List-hoverBackground)] [&_code]:px-1 [&_code]:rounded
        [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none
        [&_pre]:bg-[var(--ide-editor-bg)] [&_pre]:border [&_pre]:border-[var(--ide-Borders-color)] [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:my-3 [&_pre]:overflow-x-auto
        [&_blockquote]:border-l-4 [&_blockquote]:border-[var(--ide-List-selectionBackground)] [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:my-3
        
        /* Table Styling */
        [&_table]:w-full [&_table]:border-collapse [&_table]:my-4
        [&_th]:border [&_th]:border-[var(--ide-Borders-color)] [&_th]:p-2 [&_th]:bg-[var(--ide-List-hoverBackground)] [&_th]:font-bold [&_th]:text-left
        [&_td]:border [&_td]:border-[var(--ide-Borders-color)] [&_td]:p-2 [&_td]:align-top
        
        /* Syntax Highlighting */
        [&_.hljs-keyword]:text-[var(--ide-syntax-keyword)]
        [&_.hljs-string]:text-[var(--ide-syntax-string)]
        [&_.hljs-number]:text-[var(--ide-syntax-number)]
        [&_.hljs-comment]:text-[var(--ide-syntax-comment)]
        [&_.hljs-function]:text-[var(--ide-syntax-function)]
        [&_.hljs-title]:text-[var(--ide-syntax-function)]
        [&_.hljs-class]:text-[var(--ide-syntax-class)]
        [&_.hljs-tag]:text-[var(--ide-syntax-tag)]
        [&_.hljs-attr]:text-[var(--ide-syntax-attr)]
      "
      dangerouslySetInnerHTML={{ __html: html as string }}
    />
  );
};
