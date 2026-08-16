import { describe, expect, it } from 'vitest';
import { ConversationReplayData, ExploringBlock, ToolCallBlock, ToolCallEvent } from '../../types/chat';
import { buildReplayMessages, buildReplayToolCallEvents } from '../replay';
import {
  applyToolCallEvent,
  pendingToolCallEvents,
  ToolCallRawInputCache,
} from '../toolCallUtils';
import { FIXTURES } from './replayFixtures';

describe('shared file-change event handling', () => {
  const event = (overrides: Partial<ToolCallEvent> = {}): ToolCallEvent => ({
    eventId: 'session-1:edit-1',
    toolCallId: 'edit-1',
    title: 'Edit file',
    kind: 'edit',
    status: 'pending',
    diffs: [],
    ...overrides,
  });

  it('ignores an initial call without diffs', () => {
    expect(applyToolCallEvent([], event(), 'tool_call')).toEqual([]);
  });

  it('does not create an event from a status-only update', () => {
    expect(applyToolCallEvent([], event({ status: 'failed' }), 'tool_call_update')).toEqual([]);
  });

  it('merges a status-only update into an existing event', () => {
    const initial = event({
      diffs: [{ path: 'a.ts', oldText: 'one', newText: 'two' }],
    });
    const result = applyToolCallEvent(
      [initial],
      event({ status: 'completed' }),
      'tool_call_update'
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('completed');
    expect(result[0].diffs).toEqual(initial.diffs);
  });

  it('merges repeated calls by tool-call id using live rules', () => {
    const first = event({
      diffs: [{ path: 'a.ts', oldText: 'one', newText: 'two' }],
    });
    const second = event({
      status: 'completed',
      diffs: [{ path: 'b.ts', oldText: 'three', newText: 'four' }],
    });
    const result = applyToolCallEvent(
      applyToolCallEvent([], first, 'tool_call'),
      second,
      'tool_call'
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('completed');
    expect(result[0].diffs.map((diff) => diff.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('isolates cached raw input and clears it on session change or chat close', () => {
    const cache = new ToolCallRawInputCache();
    const first = { path: 'first.ts', file_text: 'one' };
    const second = { path: 'second.ts', file_text: 'two' };

    cache.rememberSession('chat-1', 'session-1');
    cache.rememberSession('chat-2', 'session-2');
    cache.set('chat-1', 'edit-1', first);
    cache.set('chat-2', 'edit-1', second);

    expect(cache.get('chat-1', 'edit-1')).toEqual(first);
    expect(cache.get('chat-2', 'edit-1')).toEqual(second);
    cache.rememberSession('chat-1', 'session-1');
    expect(cache.get('chat-1', 'edit-1')).toEqual(first);
    cache.delete('chat-1', 'edit-1');
    expect(cache.get('chat-1', 'edit-1')).toBeUndefined();
    cache.set('chat-1', 'edit-1', first);
    cache.rememberSession('chat-1', 'session-3');
    expect(cache.get('chat-1', 'edit-1')).toBeUndefined();
    expect(cache.get('chat-2', 'edit-1')).toEqual(second);
    cache.clearChat('chat-2');
    expect(cache.get('chat-2', 'edit-1')).toBeUndefined();
    cache.rememberSession('chat-2', 'session-2');
    cache.set('chat-2', 'edit-1', second);
    expect(cache.get('chat-2', 'edit-1')).toEqual(second);
  });

  it('keeps handled events hidden by stable ID when the replay prefix changes', () => {
    const replayEvents = ['new-before', 'replay-kept', 'new-after'].map((eventId) => event({
      eventId,
      toolCallId: eventId,
    }));
    const liveEvents = Array.from({ length: 2 }, (_, index) => event({
      eventId: `live-kept-${index}`,
      toolCallId: `live-${index}`,
    }));
    const keptIds = new Set(['replay-kept', 'live-kept-0', 'live-kept-1']);

    const pending = pendingToolCallEvents(replayEvents, liveEvents, keptIds);

    expect(pending.map((item) => item.eventId)).toEqual(['new-before', 'new-after']);
  });
});

describe('replay rendering rules', () => {
  const messagesOf = (fixture: keyof typeof FIXTURES) => buildReplayMessages(FIXTURES[fixture]);

  it('renders one user message and one assistant message per prompt', () => {
    const messages = messagesOf('plainTextExchange');
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages.map((message) => message.id)).toEqual(['replay-user-0-0', 'replay-assistant-0-0']);
    expect(messages[0].content).toBe('Explain this repository');
    expect(messages[1].content).toBe('It is a JetBrains plugin. The backend is Kotlin.');
  });

  it('generates the same message and thinking IDs every time the same history is loaded', () => {
    const firstMessages = messagesOf('thinkingAndExploringTools');
    const secondMessages = messagesOf('thinkingAndExploringTools');
    const firstExploring = firstMessages[1].contentBlocks?.find(
      (block): block is ExploringBlock => block.type === 'exploring'
    );
    const secondExploring = secondMessages[1].contentBlocks?.find(
      (block): block is ExploringBlock => block.type === 'exploring'
    );

    expect(secondMessages.map((message) => message.id)).toEqual(firstMessages.map((message) => message.id));
    expect(secondExploring?.entries.map((entry) => entry.toolCallId))
      .toEqual(firstExploring?.entries.map((entry) => entry.toolCallId));
  });

  it('carries assistant metadata onto the assistant message', () => {
    const [, assistant] = messagesOf('plainTextExchange');
    expect(assistant.agentId).toBe('claude-code');
    expect(assistant.agentName).toBe('Claude Code');
    expect(assistant.duration).toBe(12.5);
    expect(assistant.contextTokensUsed).toBe(4200);
    expect(assistant.metaComplete).toBe(true);
  });

  it('stamps the user message with the prompt start time', () => {
    expect(messagesOf('plainTextExchange')[0].timestamp).toBe(1_700_000_000_000);
  });

  it('never marks replayed blocks as streaming', () => {
    const blocks = messagesOf('thinkingAndExploringTools')[1].contentBlocks || [];
    const exploring = blocks.filter((block): block is ExploringBlock => block.type === 'exploring');
    expect(exploring.length).toBeGreaterThan(0);
    exploring.forEach((block) => {
      expect(block.isStreaming).toBe(false);
      expect(block.isReplay).toBe(true);
    });
  });

  it('groups thinking and read tools into one exploring block', () => {
    const blocks = messagesOf('thinkingAndExploringTools')[1].contentBlocks || [];
    expect(blocks.map((block) => block.type)).toEqual(['exploring', 'text']);
    const entries = (blocks[0] as ExploringBlock).entries;
    expect(entries.map((entry) => entry.kind)).toEqual(['thinking', 'read', 'search']);
    expect(entries[0].text).toBe('Let me look at the sources.');
  });

  it('reads legacy tool-call IDs from raw JSON instead of merging distinct tools', () => {
    const data: ConversationReplayData = {
      sessions: [{
        sessionId: 'legacy-session',
        adapterName: 'claude-code',
        prompts: [{
          events: [
            {
              role: 'assistant',
              type: 'tool_call',
              toolRawJson: JSON.stringify({ toolCallId: 'legacy-read-1', kind: 'read', title: 'one.ts' }),
            },
            {
              role: 'assistant',
              type: 'tool_call',
              toolRawJson: JSON.stringify({ toolCallId: 'legacy-read-2', kind: 'read', title: 'two.ts' }),
            },
          ],
        }],
      }],
    };
    const exploring = buildReplayMessages(data)[0].contentBlocks?.[0] as ExploringBlock;

    expect(exploring.entries.map((entry) => entry.toolCallId))
      .toEqual(['legacy-read-1', 'legacy-read-2']);
  });

  it('gives separate deterministic fallback IDs to tools missing IDs everywhere', () => {
    const data: ConversationReplayData = {
      sessions: [{
        sessionId: 'legacy-session',
        adapterName: 'claude-code',
        prompts: [{
          events: [
            { role: 'assistant', type: 'tool_call', toolKind: 'read', toolTitle: 'one.ts', toolRawJson: '{}' },
            { role: 'assistant', type: 'tool_call', toolKind: 'search', toolTitle: 'symbol', toolRawJson: '{}' },
          ],
        }],
      }],
    };
    const first = buildReplayMessages(data)[0].contentBlocks?.[0] as ExploringBlock;
    const second = buildReplayMessages(data)[0].contentBlocks?.[0] as ExploringBlock;

    expect(first.entries).toHaveLength(2);
    expect(new Set(first.entries.map((entry) => entry.toolCallId)).size).toBe(2);
    expect(second.entries.map((entry) => entry.toolCallId))
      .toEqual(first.entries.map((entry) => entry.toolCallId));
  });

  it('accumulates incremental execute output before passing it through live rendering', () => {
    const executeEvent = (type: 'tool_call' | 'tool_call_update', text: string, status: string) => ({
      role: 'assistant' as const,
      type,
      toolCallId: 'execute-1',
      toolKind: type === 'tool_call' ? 'execute' : undefined,
      toolTitle: type === 'tool_call' ? 'npm run build' : undefined,
      toolStatus: status,
      toolRawJson: JSON.stringify({
        toolCallId: 'execute-1',
        kind: type === 'tool_call' ? 'execute' : undefined,
        status,
        content: [{ type: 'content', content: { type: 'text', text } }],
      }),
    });
    const data: ConversationReplayData = {
      sessions: [{
        sessionId: 'legacy-session',
        adapterName: 'claude-code',
        prompts: [{
          events: [
            executeEvent('tool_call', 'compiling...', 'running'),
            executeEvent('tool_call_update', 'tests...', 'running'),
            executeEvent('tool_call_update', 'done', 'completed'),
          ],
        }],
      }],
    };
    const toolCall = buildReplayMessages(data)[0].contentBlocks?.find(
      (block): block is ToolCallBlock => block.type === 'tool_call'
    );

    expect(toolCall?.entry.result).toBe('compiling...\n\ntests...\n\ndone');
  });

  it('does not duplicate execute output when an update is already a full snapshot', () => {
    const data: ConversationReplayData = {
      sessions: [{
        sessionId: 'snapshot-session',
        adapterName: 'claude-code',
        prompts: [{
          events: [
            {
              role: 'assistant', type: 'tool_call', toolCallId: 'execute-1', toolKind: 'execute',
              toolTitle: 'npm run build', toolRawJson: JSON.stringify({
                toolCallId: 'execute-1', kind: 'execute', status: 'running',
                content: [{ type: 'content', content: { type: 'text', text: 'compiling...' } }],
              }),
            },
            {
              role: 'assistant', type: 'tool_call_update', toolCallId: 'execute-1',
              toolRawJson: JSON.stringify({
                toolCallId: 'execute-1', status: 'completed',
                content: [{ type: 'content', content: { type: 'text', text: 'compiling...\ndone' } }],
              }),
            },
          ],
        }],
      }],
    };
    const toolCall = buildReplayMessages(data)[0].contentBlocks?.find(
      (block): block is ToolCallBlock => block.type === 'tool_call'
    );

    expect(toolCall?.entry.result).toBe('compiling...\ndone');
  });

  it('keeps initial output when execute kind appears only in an update', () => {
    const data: ConversationReplayData = {
      sessions: [{
        sessionId: 'late-kind-session',
        adapterName: 'claude-code',
        prompts: [{
          events: [
            {
              role: 'assistant', type: 'tool_call', toolCallId: 'execute-1',
              toolTitle: 'command', toolRawJson: JSON.stringify({
                toolCallId: 'execute-1', status: 'running',
                content: [{ type: 'content', content: { type: 'text', text: 'compiling...' } }],
              }),
            },
            {
              role: 'assistant', type: 'tool_call_update', toolCallId: 'execute-1', toolKind: 'execute',
              toolRawJson: JSON.stringify({
                toolCallId: 'execute-1', kind: 'execute', status: 'completed',
                content: [{ type: 'content', content: { type: 'text', text: 'done' } }],
              }),
            },
          ],
        }],
      }],
    };
    const toolCall = buildReplayMessages(data)[0].contentBlocks?.find(
      (block): block is ToolCallBlock => block.type === 'tool_call'
    );

    expect(toolCall?.entry.result).toBe('compiling...\n\ndone');
  });

  it('does not duplicate incremental output for non-execute tools', () => {
    const data: ConversationReplayData = {
      sessions: [{
        sessionId: 'read-output-session',
        adapterName: 'claude-code',
        prompts: [{
          events: [
            {
              role: 'assistant', type: 'tool_call', toolCallId: 'read-1', toolKind: 'read',
              toolRawJson: JSON.stringify({
                kind: 'read',
                content: [{ type: 'content', content: { type: 'text', text: 'first' } }],
              }),
            },
            {
              role: 'assistant', type: 'tool_call_update', toolCallId: 'read-1',
              toolStatus: 'completed',
              toolRawJson: JSON.stringify({
                status: 'completed',
                content: [{ type: 'content', content: { type: 'text', text: 'second' } }],
              }),
            },
          ],
        }],
      }],
    };
    const exploring = buildReplayMessages(data)[0].contentBlocks?.find(
      (block): block is ExploringBlock => block.type === 'exploring'
    );

    expect(exploring?.entries[0].result).toBe('first\n\nsecond');
  });

  it('splits a multi-file edit into one block per file', () => {
    const blocks = messagesOf('multiFileEditSplit')[1].contentBlocks || [];
    const toolCalls = blocks.filter((block): block is ToolCallBlock => block.type === 'tool_call');
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map((block) => block.entry.locations?.[0]?.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('keeps a failed edit without a diff, matching live rendering', () => {
    const withoutDiffs = messagesOf('editWithoutDiffs')[1].contentBlocks || [];
    const toolCall = withoutDiffs.find((block): block is ToolCallBlock => block.type === 'tool_call');
    expect(toolCall?.entry.toolCallId).toBe('e3');
    expect(toolCall?.entry.status).toBe('failed');
  });

  it('drops an edit that changes nothing', () => {
    const zeroDiff = messagesOf('zeroDiffEdit')[1].contentBlocks || [];
    expect(zeroDiff.every((block) => block.type !== 'tool_call')).toBe(true);
  });

  it('fails tool calls that were still pending when the prompt ended', () => {
    const blocks = messagesOf('pendingToolAtCancel')[1].contentBlocks || [];
    const toolCall = blocks.find((block): block is ToolCallBlock => block.type === 'tool_call');
    const exploring = blocks.find((block): block is ExploringBlock => block.type === 'exploring');
    expect(toolCall?.entry.status).toBe('failed');
    expect(exploring?.entries[0].status).toBe('failed');
  });

  it('keeps code references, images and files in the user message', () => {
    const [user] = messagesOf('richUserBlocks');
    expect(user.blocks?.map((block) => block.type)).toEqual(['text', 'code_ref', 'text', 'image', 'file']);
    expect(user.content).toBe('Look at @src/App.tsx#L10-20 and this shot');
  });

  it('mergesAdjacentUserTextBlocks', () => {
    const [user] = messagesOf('consecutiveUserTextBlocks');
    expect(user.blocks).toHaveLength(1);
    expect(user.content).toBe('Context from the previous chat.\n\nNow continue here.');
  });

  it('strips slash-command markup and transferred context from user text', () => {
    expect(messagesOf('userCommandMarkup')[0].content).toBe('Actual request');
    expect(messagesOf('transferredContext')[0].content).toBe('The real question');
  });

  it('keeps the assistant message when a prompt has metadata but no events', () => {
    const messages = messagesOf('promptWithoutEvents');
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[3].contentBlocks).toEqual([]);
    expect(messages[3].metaComplete).toBe(true);
  });

  it('does not merge a prompt without user blocks into the previous answer', () => {
    const messages = messagesOf('promptWithoutUserBlocks');
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(messages[1].content).toBe('First answer');
    expect(messages[2].content).toBe('Second answer with no visible prompt');
  });

  it('ignores replayed user-role events', () => {
    const [, assistant] = messagesOf('userRoleEventIsIgnored');
    expect(assistant.content).toBe('Answer');
  });

  it('returns nothing for an empty conversation', () => {
    expect(buildReplayMessages(FIXTURES.emptyConversation)).toEqual([]);
  });

  it('collects diffs for the file changes panel', () => {
    const events = buildReplayToolCallEvents(FIXTURES.multiFileEditSplit);
    expect(events).toHaveLength(1);
    expect(events[0].diffs.map((diff) => diff.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('keeps session-local tool-call IDs separate across sessions', () => {
    const edit = (toolCallId: string, path: string, oldText: string, newText: string) => ({
      role: 'assistant' as const,
      type: 'tool_call',
      toolCallId,
      toolKind: 'edit',
      toolStatus: 'completed',
      toolRawJson: JSON.stringify({
        toolCallId,
        kind: 'edit',
        status: 'completed',
        content: [{ type: 'diff', path, oldText, newText }],
      }),
    });
    const data: ConversationReplayData = {
      sessions: [
        {
          sessionId: 'session-1',
          adapterName: 'claude-code',
          prompts: [
            { events: [edit('edit-1', 'a.ts', 'a1', 'a2')] },
            { events: [edit('edit-2', 'b.ts', 'b1', 'b2')] },
          ],
        },
        {
          sessionId: 'session-2',
          adapterName: 'codex',
          prompts: [{ events: [edit('edit-1', 'a.ts', 'a2', 'a3')] }],
        },
      ],
    };
    const events = buildReplayToolCallEvents(data);
    const reorderedEvents = buildReplayToolCallEvents({
      sessions: [data.sessions[1], data.sessions[0]],
    });

    expect(events).toHaveLength(3);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(3);
    expect(events.map((event) => event.diffs[0])).toEqual([
      { path: 'a.ts', oldText: 'a1', newText: 'a2' },
      { path: 'b.ts', oldText: 'b1', newText: 'b2' },
      { path: 'a.ts', oldText: 'a2', newText: 'a3' },
    ]);
    expect(Object.fromEntries(events.map((event) => [event.diffs[0].newText, event.eventId])))
      .toEqual(Object.fromEntries(reorderedEvents.map((event) => [event.diffs[0].newText, event.eventId])));
  });
});
