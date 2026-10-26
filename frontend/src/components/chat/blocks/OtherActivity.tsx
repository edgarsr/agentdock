import React, { useMemo } from 'react';
import { ToolCallEntry } from '../../../types/chat';
import { Wrench } from 'lucide-react';
import { parseToolStatus, safeParseJson } from '../../../utils/toolCallUtils';
import { isInlineImageText, toolCallPrompt } from '../../../utils/toolCallImages';
import { MarkdownMessage } from '../MarkdownMessage';
import { useShownImages } from '../useShownImages';
import { sanitizeMarkdownHtml } from '../../../utils/sanitizeHtml';
import { ExpandableActivity } from './ExpandableActivity';

interface Props {
  entry: ToolCallEntry;
  isActivePrompt?: boolean;
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


export const OtherActivity: React.FC<Props> = ({ entry, isActivePrompt = false }) => {
  const { isFinished } = parseToolStatus(entry.status);
  const json = safeParseJson(entry.rawJson);
  const skillName = typeof json?.rawInput?.skill === 'string' ? json.rawInput.skill.trim() : '';
  const skillArgs = json?.rawInput?.args;
  const title = skillName
    ? `Launching skill: ${skillName}`
    : (entry.title || entry.kind || 'Tool activity');

  const { promptText, bodyText } = useMemo(() => {
    const promptText = toolCallPrompt(json);

    let bodyText = '';
    if (entry.result?.trim()) {
      bodyText = entry.result;
    } else if (Array.isArray(json.content)) {
      const contentText = json.content
        .map((c: { text?: string; content?: { text?: string } }) => c?.text || c?.content?.text)
        .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n\n');
      if (contentText) bodyText = contentText;
    }

    if (!bodyText) {
      const rawContent = json?.rawOutput?.content;
      if (typeof rawContent === 'string' && rawContent.trim()) bodyText = rawContent.trim();
    }

    if (bodyText && isInlineImageText(bodyText)) bodyText = '';
    return { promptText, bodyText };
  }, [entry.rawJson, entry.result]);
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
  const [shownImages, handleShowImage] = useShownImages();
  const sanitizedHtmlBody = useMemo(() => (
    markdownBody ? null : sanitizeMarkdownHtml(bodyText, shownImages)
  ), [markdownBody, bodyText, shownImages]);

  const argsText = skillArgs !== undefined
    ? (typeof skillArgs === 'string' ? skillArgs.trim() : JSON.stringify(skillArgs, null, 2))
    : '';
  const emptyNotice = promptText && !bodyText
    ? (isFinished ? 'No text output.' : 'Waiting for response...')
    : '';
  const hasContent = !!(argsText || promptText || bodyText);

  return (
    <ExpandableActivity icon={<Wrench size={13} className="flex-shrink-0" />} label={title}
      status={entry.status} isActivePrompt={isActivePrompt}
    >
      {hasContent && (
        <div className="leading-relaxed min-h-[0.5rem]">
          {argsText && (<div className="mb-2 text-sm font-mono whitespace-pre-wrap break-words opacity-70">Arguments: {argsText}</div>)}
          {promptText && (<div className="mb-2"><b>Prompt: </b>{promptText}<hr /></div>)}
          {bodyText ? (
            markdownBody
              ? <MarkdownMessage content={markdownBody} enableCodeCopy={false} />
              : <div className="text-sm font-mono whitespace-pre-wrap break-words" onClick={handleShowImage}
                  dangerouslySetInnerHTML={{ __html: sanitizedHtmlBody || '' }} />
          ) : (
            emptyNotice ? <span className="opacity-40 italic">{emptyNotice}</span> : null
          )}
        </div>
      )}
    </ExpandableActivity>
  );
};
