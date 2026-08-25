import {
  ContentChunk,
  ConversationReplayData,
  Message,
  ReplayContentBlock,
  ReplayPromptEntry,
  ToolCallEvent,
} from '../types/chat';
import { applyChunks } from '../hooks/chatSession/messageProcessing';
import { stripTransferredContextForDisplay } from '../hooks/chatSession/chunkBlockHelpers';
import {
  applyToolCallEvent,
  extractResultTexts,
  extractToolCallDiffEntries,
  safeParseJson,
  stableToolCallEventId,
} from './toolCallUtils';

const REPLAY_IGNORED_USER_COMMAND_TAGS = [
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'local-command-stderr',
  'task-notification',
];

const REPLAY_IGNORED_USER_COMMAND_PATTERNS = REPLAY_IGNORED_USER_COMMAND_TAGS.map(
  (tag) => new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi')
);

const ASSISTANT_EVENT_TYPES = new Set([
  'text',
  'thinking',
  'image',
  'audio',
  'video',
  'file',
  'tool_call',
  'tool_call_update',
  'plan',
]);

function stripReplayCommandMarkup(text: string): string {
  let sanitized = text;
  REPLAY_IGNORED_USER_COMMAND_PATTERNS.forEach((pattern) => {
    sanitized = sanitized.replace(pattern, '');
  });
  return sanitized;
}

function baseChunk(role: 'user' | 'assistant'): ContentChunk {
  return { chatId: '', role, type: 'text', isReplay: true };
}

interface ReplayToolIdentityState {
  lastToolCallId?: string;
}

function rawToolCallId(raw: Record<string, any>): string | undefined {
  const candidate = raw.toolCallId ?? raw.tool_call_id;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function replayToolCallId(
  event: ReplayContentBlock,
  raw: Record<string, any>,
  promptKey: string,
  eventIndex: number,
  state: ReplayToolIdentityState
): string {
  const explicitId = event.toolCallId || rawToolCallId(raw);
  if (explicitId) {
    if (event.type === 'tool_call') state.lastToolCallId = explicitId;
    return explicitId;
  }

  if (event.type === 'tool_call_update' && state.lastToolCallId) {
    return state.lastToolCallId;
  }

  const fallbackId = `${promptKey}-tool-${eventIndex}`;
  if (event.type === 'tool_call') state.lastToolCallId = fallbackId;
  return fallbackId;
}

function mergeReplayExecuteOutput(previous: string | undefined, incoming: string): string {
  if (!previous) return incoming;
  const normalizedPrevious = previous.replace(/\r\n?/g, '\n');
  const normalizedIncoming = incoming.replace(/\r\n?/g, '\n');
  if (normalizedIncoming === normalizedPrevious || normalizedIncoming.startsWith(normalizedPrevious)) return incoming;
  if (normalizedPrevious.endsWith(normalizedIncoming)) return previous;
  return `${previous}\n\n${incoming}`;
}

function mergeReplayToolContent(
  previousRaw: Record<string, any> | undefined,
  incomingRaw: Record<string, any>
): Record<string, any> {
  const previousContent = Array.isArray(previousRaw?.content) ? previousRaw.content : [];
  const incomingContent = Array.isArray(incomingRaw.content) ? incomingRaw.content : [];
  const isTextBlock = (item: any) => Boolean(
    item && typeof item === 'object' && (
      (item.content && typeof item.content === 'object' && typeof item.content.text === 'string')
      || typeof item.text === 'string'
    )
  );
  const sameBlock = (left: any, right: any) => JSON.stringify(left) === JSON.stringify(right);
  const previousOutput = extractResultTexts(previousRaw || {});
  const incomingOutput = extractResultTexts(incomingRaw);
  if (previousContent.length === 0 && incomingContent.length === 0
    && (!previousOutput || !incomingOutput)) {
    return { ...previousRaw, ...incomingRaw };
  }
  const mergedOutput = previousOutput && incomingOutput
    ? mergeReplayExecuteOutput(previousOutput, incomingOutput)
    : (incomingOutput || previousOutput);
  const incomingTextBlocks = incomingContent.filter(isTextBlock);
  const incomingStructuredBlocks = incomingContent.filter((item: any) => !isTextBlock(item));
  const previousHasTextBlock = previousContent.some(isTextBlock);
  const isIncomingSnapshot = Boolean(
    previousOutput && incomingOutput && mergedOutput === incomingOutput
  );
  const keepsPreviousText = Boolean(
    previousOutput && incomingOutput && mergedOutput === previousOutput
  );
  const mergedContent: any[] = [];

  if (isIncomingSnapshot) {
    let insertedText = false;
    previousContent.forEach((item: any) => {
      if (!isTextBlock(item)) {
        mergedContent.push(item);
      } else if (!insertedText) {
        mergedContent.push(...(
          incomingTextBlocks.length > 0
            ? incomingTextBlocks
            : [{ type: 'content', content: { type: 'text', text: mergedOutput } }]
        ));
        insertedText = true;
      }
    });
    if (!insertedText) {
      mergedContent.push(...(
        incomingTextBlocks.length > 0
          ? incomingTextBlocks
          : [{ type: 'content', content: { type: 'text', text: mergedOutput } }]
      ));
    }
    incomingStructuredBlocks.forEach((item: any) => {
      if (!previousContent.some((existing: any) => sameBlock(existing, item))) mergedContent.push(item);
    });
  } else {
    mergedContent.push(...previousContent);
    incomingContent.forEach((item: any) => {
      if (isTextBlock(item)) {
        if (!keepsPreviousText) mergedContent.push(item);
      } else if (!previousContent.some((existing: any) => sameBlock(existing, item))) {
        mergedContent.push(item);
      }
    });
    if (previousOutput && incomingOutput && incomingTextBlocks.length === 0) {
      mergedContent.push({
        type: 'content',
        content: {
          type: 'text',
          text: previousHasTextBlock && !keepsPreviousText ? incomingOutput : mergedOutput,
        },
      });
    }
  }

  return { ...previousRaw, ...incomingRaw, content: mergedContent };
}

function replayAssistantChunks(prompt: ReplayPromptEntry, promptKey: string): ContentChunk[] {
  const identityState: ReplayToolIdentityState = {};
  const toolKinds = new Map<string, string>();
  const observedToolRaws = new Map<string, Record<string, any>>();

  return (prompt.events || []).flatMap((event, eventIndex) => {
    if (event.role && event.role !== 'assistant') return [];
    const type = event.type || 'text';
    if (!ASSISTANT_EVENT_TYPES.has(type)) return [];

    const raw = safeParseJson(event.toolRawJson);
    const isToolEvent = type === 'tool_call' || type === 'tool_call_update';
    const toolCallId = isToolEvent
      ? replayToolCallId(event, raw, promptKey, eventIndex, identityState)
      : (type === 'thinking' ? `${promptKey}-thinking-${eventIndex}` : event.toolCallId);
    const rawKind = typeof raw.kind === 'string' ? raw.kind : undefined;
    const toolKind = event.toolKind || rawKind || (toolCallId ? toolKinds.get(toolCallId) : undefined);
    if (toolCallId && toolKind) toolKinds.set(toolCallId, toolKind);

    let toolRawJson = event.toolRawJson;
    // Legacy replay can store execute output as deltas. Track output even before
    // kind is known, because some adapters provide kind only in a later update.
    if (isToolEvent && toolCallId) {
      const previousRaw = observedToolRaws.get(toolCallId);
      const mergedRaw = previousRaw && toolKind?.toLowerCase() !== 'edit'
        ? mergeReplayToolContent(previousRaw, raw)
        : raw;
      observedToolRaws.set(toolCallId, mergedRaw);
      if (toolKind?.toLowerCase() === 'execute') {
        toolRawJson = JSON.stringify(mergedRaw);
      }
    }

    return [{
      ...baseChunk('assistant'),
      type: type as ContentChunk['type'],
      text: event.text,
      data: event.data,
      path: event.path,
      name: event.name,
      mimeType: event.mimeType,
      toolCallId,
      toolKind,
      toolTitle: event.toolTitle,
      toolStatus: event.toolStatus,
      toolRawJson,
      planEntries: event.planEntries,
    }];
  });
}

/** Stored prompt blocks are the blocks the composer sent, so they carry attachment types too. */
function userChunkFromBlock(block: ReplayContentBlock): ContentChunk | null {
  const type = block.type || 'text';
  switch (type) {
    case 'image':
      return {
        ...baseChunk('user'),
        type: 'image',
        data: block.data || '',
        mimeType: block.mimeType || '',
        isInline: block.isInline,
      };
    case 'audio':
    case 'video':
      return {
        ...baseChunk('user'),
        type: type as 'audio' | 'video',
        data: block.data || '',
        mimeType: block.mimeType || '',
      };
    case 'file':
      return {
        ...baseChunk('user'),
        type: 'file',
        name: block.name || 'file',
        mimeType: block.mimeType || 'application/octet-stream',
        data: block.data,
        path: block.path,
      };
    case 'code_ref':
      return {
        ...baseChunk('user'),
        type: 'code_ref',
        name: block.name || block.path || 'reference',
        path: block.path || '',
        startLine: block.startLine,
        endLine: block.endLine,
      };
    default: {
      const text = stripReplayCommandMarkup(
        stripTransferredContextForDisplay(block.text || '', 'user', true)
      );
      if (!text.trim()) return null;
      return { ...baseChunk('user'), type: 'text', text };
    }
  }
}

function promptDoneChunk(prompt: ReplayPromptEntry): ContentChunk | null {
  const meta = prompt.assistantMeta;
  if (!meta) return null;
  return {
    ...baseChunk('assistant'),
    type: 'prompt_done',
    agentId: meta.agentId,
    agentName: meta.agentName,
    configOptions: meta.configOptions,
    promptStartedAtMillis: meta.promptStartedAtMillis,
    durationSeconds: meta.durationSeconds,
    contextTokensUsed: meta.contextTokensUsed,
    contextWindowSize: meta.contextWindowSize,
  };
}

function buildPromptMessages(
  prompt: ReplayPromptEntry,
  sessionIndex: number,
  promptIndex: number
): Message[] {
  const messages: Message[] = [];
  const promptKey = `replay-${sessionIndex}-${promptIndex}`;

  const userChunks = (prompt.blocks || [])
    .map(userChunkFromBlock)
    .filter((chunk): chunk is ContentChunk => chunk !== null);
  if (userChunks.length > 0) {
    applyChunks([], userChunks).forEach((message, messageIndex) => {
      messages.push({
        ...message,
        id: messageIndex === 0
          ? `replay-user-${sessionIndex}-${promptIndex}`
          : `replay-user-${sessionIndex}-${promptIndex}-${messageIndex}`,
        timestamp: prompt.assistantMeta?.promptStartedAtMillis,
      });
    });
  }

  const assistantChunks = replayAssistantChunks(prompt, promptKey);
  const doneChunk = promptDoneChunk(prompt);
  if (assistantChunks.length === 0 && !doneChunk) return messages;

  // Seed the assistant message so every event is merged into an existing message,
  // exactly like a live prompt where the message is created before the agent replies.
  const seed: Message = {
    id: `replay-assistant-${sessionIndex}-${promptIndex}`,
    role: 'assistant',
    content: '',
    contentBlocks: [],
    metaComplete: false,
  };
  const chunks = doneChunk ? [...assistantChunks, doneChunk] : assistantChunks;
  applyChunks([seed], chunks)
    .filter((message) => (message.contentBlocks?.length ?? 0) > 0 || message.metaComplete)
    .forEach((message) => messages.push(message));

  return messages;
}

/**
 * Turns a stored conversation into messages through the same chunk pipeline that
 * renders live agent output, so both paths share one set of rendering rules.
 */
export function buildReplayMessages(data: ConversationReplayData): Message[] {
  const messages: Message[] = [];
  (data.sessions || []).forEach((session, sessionIndex) => {
    (session.prompts || []).forEach((prompt, promptIndex) => {
      messages.push(...buildPromptMessages(prompt, sessionIndex, promptIndex));
    });
  });
  return messages;
}

function extractReplayToolCallEvent(
  event: ReplayContentBlock,
  adapterName: string,
  sessionId: string,
  promptKey: string,
  eventIndex: number,
  identityState: ReplayToolIdentityState
): {
  eventType: 'tool_call' | 'tool_call_update';
  payload: ToolCallEvent;
} | null {
  const type = event.type || '';
  if (type !== 'tool_call' && type !== 'tool_call_update') return null;
  const raw = safeParseJson(event.toolRawJson);
  const toolCallId = replayToolCallId(event, raw, promptKey, eventIndex, identityState);
  const eventId = stableToolCallEventId(adapterName, sessionId, toolCallId);
  const diffs = extractToolCallDiffEntries(raw)
    .map((item: any) => ({ path: item.path, oldText: item.oldText ?? null, newText: item.newText ?? '' }));

  if (diffs.length > 0) {
    return {
      eventType: type,
      payload: {
        eventId,
        toolCallId,
        title: event.toolTitle || raw.title || '',
        kind: event.toolKind || raw.kind,
        status: event.toolStatus || raw.status,
        diffs,
        locations: raw.locations,
      },
    };
  }

  if (type === 'tool_call_update' && (event.toolStatus || raw.status)) {
    return {
      eventType: type,
      payload: {
        eventId,
        toolCallId,
        title: event.toolTitle || raw.title || '',
        kind: event.toolKind || raw.kind,
        status: event.toolStatus || raw.status,
        diffs: [],
      },
    };
  }

  return null;
}

export function buildReplayToolCallEvents(data: ConversationReplayData): ToolCallEvent[] {
  const toolCallEvents: ToolCallEvent[] = [];
  (data.sessions || []).forEach((session, sessionIndex) => {
    (session.prompts || []).forEach((prompt, promptIndex) => {
      const promptKey = `replay-${sessionIndex}-${promptIndex}`;
      const identityState: ReplayToolIdentityState = {};
      let promptToolCallEvents: ToolCallEvent[] = [];
      (prompt.events || []).forEach((event, eventIndex) => {
        const extracted = extractReplayToolCallEvent(
          event,
          session.adapterName,
          session.sessionId,
          promptKey,
          eventIndex,
          identityState
        );
        if (!extracted) return;
        promptToolCallEvents = applyToolCallEvent(
          promptToolCallEvents,
          extracted.payload,
          extracted.eventType
        );
      });
      toolCallEvents.push(...promptToolCallEvents);
    });
  });
  return toolCallEvents;
}
