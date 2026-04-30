import React, { useMemo } from 'react';
import { ToolCallBlock } from '../../../types/chat';
import { ChevronRight, Wrench } from 'lucide-react';
import { parseToolStatus, safeParseJson } from '../../../utils/toolCallUtils';
import { useAutoCollapse } from '../../../hooks/useAutoCollapse';
import { MarkdownMessage } from '../MarkdownMessage';
import { sanitizeMarkdownHtml } from '../../../utils/sanitizeHtml';
import { chatInsetFocusClassName } from '../shared/focusStyles';

interface Props {
  block: ToolCallBlock;
}

function tryFormatJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

export const OtherToolBlock: React.FC<Props> = ({ block }) => {
  const { isPending, isError } = parseToolStatus(block.entry.status);
  const { isExpanded, toggle } = useAutoCollapse();
  const json = safeParseJson(block.entry.rawJson);
  if (json?.rawInput?.todos) {
    return (<></>);
  }

  const skillName = typeof json?.rawInput?.skill === 'string' ? json.rawInput.skill.trim() : '';
  const skillArgs = json?.rawInput?.args;
  const title = skillName
    ? `Launching skill: ${skillName}`
    : (block.entry.title || block.entry.kind || 'Tool activity');

  const { promptText, bodyText } = useMemo(() => {
    const promptText = typeof json?.rawInput?.prompt === 'string' && json.rawInput.prompt.trim()
      ? json.rawInput.prompt.trim()
      : '';

    let bodyText = '';
    if (block.entry.result?.trim()) {
      bodyText = block.entry.result;
    } else if (Array.isArray(json.content)) {
      const contentText = json.content
        .map((c: { text?: string; content?: { text?: string } }) => c?.text || c?.content?.text)
        .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n\n');
      if (contentText) {
        bodyText = contentText;
      }
    }

    if (!bodyText) {
      const rawContent = json?.rawOutput?.content;
      if (typeof rawContent === 'string' && rawContent.trim()) {
        bodyText = rawContent.trim();
      }
    }

    return { promptText, bodyText };
  }, [block.entry.rawJson, block.entry.result]);
  const formattedJsonBody = useMemo(() => (
    bodyText ? tryFormatJson(bodyText) : null
  ), [bodyText]);
  const bodyIsMarkdown = bodyText ? !/^\s*<[a-zA-Z!?]/.test(bodyText) : false;
  const markdownBody = useMemo(() => {
    if (formattedJsonBody) {
      return `\`\`\`json\n${formattedJsonBody}\n\`\`\``;
    }
    return bodyIsMarkdown ? bodyText : null;
  }, [formattedJsonBody, bodyIsMarkdown, bodyText]);
  const sanitizedHtmlBody = useMemo(() => (
    markdownBody ? null : sanitizeMarkdownHtml(bodyText)
  ), [markdownBody, bodyText]);

  const argsText = skillArgs !== undefined
    ? (typeof skillArgs === 'string' ? skillArgs.trim() : JSON.stringify(skillArgs, null, 2))
    : '';
  const hasContent = !!(argsText || promptText || bodyText);

  return (
    <div className="border border-border rounded-[6px] overflow-hidden mb-2">
      <button
        onClick={hasContent ? toggle : undefined}
        className={`flex items-center gap-2 w-full px-3 h-9 bg-editor-bg ${chatInsetFocusClassName}${hasContent ? '' : ' cursor-default'}`}
      >
        <div className="flex-shrink-0 text-editor-fg opacity-70">
          <Wrench size={14} />
        </div>
        <div className="flex-1 text-left font-mono truncate text-editor-fg opacity-90 pr-2">
          {title}
        </div>
        <div className="flex-shrink-0 flex items-center gap-2">
          {(isPending || isError) && (
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isPending ? 'bg-warning animate-pulse' : 'bg-error'
              }`}
            />
          )}
          {hasContent && (
            <div className={`transition-transform duration-200 text-editor-fg opacity-50 ${isExpanded ? 'rotate-90' : ''}`}>
              <ChevronRight size={14} />
            </div>
          )}
        </div>
      </button>

      {hasContent && (
        <div className="grid transition-[grid-template-rows] duration-300 ease-in-out overflow-hidden"
          style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
          <div tabIndex={-1} className="p-3 bg-editor-bg max-h-[400px] text-ide-small overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent border-t border-border">
              <div className="leading-relaxed text-editor-fg min-h-[0.5rem]">
                {argsText && (<div className="mb-2 text-sm font-mono whitespace-pre-wrap break-words opacity-70">Arguments: {argsText}</div>)}
                {promptText && (<div className="mb-2"><b>Prompt: </b>{promptText}<hr /></div>)}
                {bodyText && (
                  markdownBody
                    ? <MarkdownMessage content={markdownBody} enableCodeCopy={false} />
                    : <div className="text-sm font-mono whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: sanitizedHtmlBody || '' }} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
