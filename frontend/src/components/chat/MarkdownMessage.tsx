import React, { useMemo } from 'react';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from '../../utils/highlight';
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
    <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html as string }} />
  );
};
