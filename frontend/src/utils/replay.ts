import {
  ChatAttachedPayload,
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
  extractToolCallDiffEntries,
  safeParseJson,
  stableToolCallEventId,
} from './toolCallUtils';

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

function replayAssistantChunks(prompt: ReplayPromptEntry, promptKey: string): ContentChunk[] {
  const identityState: ReplayToolIdentityState = {};
  const toolKinds = new Map<string, string>();

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
      toolRawJson: event.toolRawJson,
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
    case 'quote':
      return block.quote ? { ...baseChunk('user'), type: 'quote', quote: block.quote } : null;
    default: {
      const text = stripTransferredContextForDisplay(block.text || '', 'user', true);
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

/** A [live] prompt is the one the agent is still answering: its assistant message stays open. */
function buildPromptMessages(prompt: ReplayPromptEntry, key: string, live = false): Message[] {
  const messages: Message[] = [];
  const promptKey = `replay-${key}`;

  const userChunks = (prompt.blocks || [])
    .map(userChunkFromBlock)
    .filter((chunk): chunk is ContentChunk => chunk !== null);
  if (userChunks.length > 0) {
    applyChunks([], userChunks).forEach((message, messageIndex) => {
      messages.push({
        ...message,
        id: messageIndex === 0 ? `replay-user-${key}` : `replay-user-${key}-${messageIndex}`,
        timestamp: prompt.assistantMeta?.promptStartedAtMillis,
      });
    });
  }

  const assistantChunks = replayAssistantChunks(prompt, promptKey);
  const doneChunk = live ? null : promptDoneChunk(prompt);
  if (!live && assistantChunks.length === 0 && !doneChunk) return messages;

  // Seed the assistant message so every event is merged into an existing message,
  // exactly like a live prompt where the message is created before the agent replies.
  const meta = prompt.assistantMeta;
  const seed: Message = {
    id: `replay-assistant-${key}`,
    role: 'assistant',
    content: '',
    contentBlocks: [],
    metaComplete: false,
    ...(live ? {
      timestamp: meta?.promptStartedAtMillis,
      agentId: meta?.agentId,
      agentName: meta?.agentName,
      configOptions: meta?.configOptions,
      promptStartedAtMillis: meta?.promptStartedAtMillis,
    } : {}),
  };
  const chunks = doneChunk ? [...assistantChunks, doneChunk] : assistantChunks;
  applyChunks([seed], chunks)
    .filter((message) => live || (message.contentBlocks?.length ?? 0) > 0 || message.metaComplete)
    .forEach((message) => messages.push(message));

  return messages;
}

/** The prompt the agent is still answering, for a UI taking the chat over; its later events continue it. */
export function buildLivePromptMessages(prompt: ReplayPromptEntry): Message[] {
  return buildPromptMessages(prompt, 'live', true);
}

/** The stored conversation followed by the prompt the agent is still answering. */
export function attachedConversation(payload: ChatAttachedPayload): ConversationReplayData {
  const sessions = [...(payload.data?.sessions || [])];
  const live = payload.livePrompt;
  if (!live) return { sessions };
  const last = sessions[sessions.length - 1];
  if (last?.sessionId === live.sessionId && last.adapterName === live.adapterName) {
    sessions[sessions.length - 1] = { ...last, prompts: [...(last.prompts || []), live.prompt] };
  } else {
    sessions.push({ sessionId: live.sessionId, adapterName: live.adapterName, prompts: [live.prompt] });
  }
  return { sessions };
}

/**
 * Turns a stored conversation into messages through the same chunk pipeline that
 * renders live agent output, so both paths share one set of rendering rules.
 */
export function buildReplayMessages(data: ConversationReplayData): Message[] {
  const messages: Message[] = [];
  (data.sessions || []).forEach((session, sessionIndex) => {
    (session.prompts || []).forEach((prompt, promptIndex) => {
      messages.push(...buildPromptMessages(prompt, `${sessionIndex}-${promptIndex}`));
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
