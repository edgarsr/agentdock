import { ConversationReplayData, ReplayPromptEntry } from '../../types/chat';

function meta(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'claude-code',
    agentName: 'Claude Code',
    configOptions: [{ id: 'model', name: 'Model', value: 'opus', displayValue: 'Opus' }],
    promptStartedAtMillis: 1_700_000_000_000,
    durationSeconds: 12.5,
    contextTokensUsed: 4200,
    contextWindowSize: 200000,
    ...overrides,
  };
}

function toolCall(id: string, kind: string, title: string, status: string, raw: Record<string, unknown>) {
  return {
    role: 'assistant' as const,
    type: 'tool_call',
    toolCallId: id,
    toolKind: kind,
    toolTitle: title,
    toolStatus: status,
    toolRawJson: JSON.stringify({ toolCallId: id, kind, title, status, ...raw }),
  };
}

function session(prompts: ReplayPromptEntry[], sessionId = 'session-1') {
  return { sessionId, adapterName: 'claude-code', prompts };
}

export const FIXTURES: Record<string, ConversationReplayData> = {
  plainTextExchange: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'Explain this repository' }],
      events: [
        { role: 'assistant', type: 'text', text: 'It is a JetBrains plugin. ' },
        { role: 'assistant', type: 'text', text: 'The backend is Kotlin.' },
      ],
      assistantMeta: meta(),
    }])],
  },

  thinkingAndExploringTools: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'Where is the bridge?' }],
      events: [
        { role: 'assistant', type: 'thinking', text: 'Let me look ' },
        { role: 'assistant', type: 'thinking', text: 'at the sources.' },
        toolCall('t1', 'read', 'AcpBridge.kt', 'completed', {
          content: [{ type: 'content', content: { type: 'text', text: 'file body' } }],
        }),
        toolCall('t2', 'search', 'pushContentChunk', 'completed', {}),
        { role: 'assistant', type: 'text', text: 'It lives in AcpBridge.kt.' },
      ],
      assistantMeta: meta(),
    }])],
  },

  singleFileEdit: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'Rename the flag' }],
      events: [
        toolCall('e1', 'edit', 'Edit AcpBridge.kt', 'completed', {
          locations: [{ path: 'src/AcpBridge.kt' }],
          content: [{ type: 'diff', path: 'src/AcpBridge.kt', oldText: 'val a = 1', newText: 'val b = 1' }],
        }),
        { role: 'assistant', type: 'text', text: 'Renamed.' },
      ],
      assistantMeta: meta(),
    }])],
  },

  multiFileEditSplit: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'Update both files' }],
      events: [
        toolCall('e2', 'edit', 'Edit 2 files', 'completed', {
          locations: [{ path: 'a.ts' }, { path: 'b.ts' }],
          content: [
            { type: 'diff', path: 'a.ts', oldText: 'one', newText: 'two' },
            { type: 'diff', path: 'b.ts', oldText: 'three', newText: 'four' },
          ],
        }),
      ],
      assistantMeta: meta(),
    }])],
  },

  editWithoutDiffs: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'Try an edit' }],
      events: [
        toolCall('e3', 'edit', 'Edit denied.ts', 'failed', {}),
        { role: 'assistant', type: 'text', text: 'The edit was rejected.' },
      ],
      assistantMeta: meta(),
    }])],
  },

  zeroDiffEdit: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'No-op edit' }],
      events: [
        toolCall('e4', 'edit', 'Edit same.ts', 'completed', {
          content: [{ type: 'diff', path: 'same.ts', oldText: 'x', newText: 'x' }],
        }),
      ],
      assistantMeta: meta(),
    }])],
  },

  impactfulExecute: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'Run the build' }],
      events: [
        toolCall('x1', 'execute', 'npm run build', 'completed', {
          content: [{ type: 'content', content: { type: 'text', text: 'built ok' } }],
        }),
      ],
      assistantMeta: meta(),
    }])],
  },

  toolCallThenUpdate: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'Read then finish' }],
      events: [
        toolCall('u1', 'read', 'notes.md', 'pending', {}),
        {
          role: 'assistant',
          type: 'tool_call_update',
          toolCallId: 'u1',
          toolRawJson: JSON.stringify({
            toolCallId: 'u1',
            status: 'completed',
            content: [{ type: 'content', content: { type: 'text', text: 'note body' } }],
          }),
        },
      ],
      assistantMeta: meta(),
    }])],
  },

  planUpdate: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'Make a plan' }],
      events: [
        {
          role: 'assistant',
          type: 'plan',
          planEntries: [
            { content: 'Investigate', status: 'completed' },
            { content: 'Implement', status: 'in_progress' },
          ],
        },
        { role: 'assistant', type: 'text', text: 'Plan ready.' },
      ],
      assistantMeta: meta(),
    }])],
  },

  pendingToolAtCancel: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'Do something long' }],
      events: [
        toolCall('p1', 'edit', 'Edit slow.ts', 'pending', {
          content: [{ type: 'diff', path: 'slow.ts', oldText: 'a', newText: 'b' }],
        }),
        toolCall('p2', 'read', 'slow.ts', 'pending', {}),
      ],
      assistantMeta: meta({ durationSeconds: 3 }),
    }])],
  },

  richUserBlocks: {
    sessions: [session([{
      blocks: [
        { type: 'text', text: 'Look at ' },
        { type: 'code_ref', name: 'App.tsx', path: 'src/App.tsx', startLine: 10, endLine: 20 },
        { type: 'text', text: ' and this shot' },
        { type: 'image', data: 'AAA', mimeType: 'image/png', isInline: false },
        { type: 'file', name: 'log.txt', mimeType: 'text/plain', path: '/tmp/log.txt' },
      ],
      events: [{ role: 'assistant', type: 'text', text: 'Looked.' }],
      assistantMeta: meta(),
    }])],
  },

  consecutiveUserTextBlocks: {
    sessions: [session([{
      blocks: [
        { type: 'text', text: 'Context from the previous chat.\n\n' },
        { type: 'text', text: 'Now continue here.' },
      ],
      events: [{ role: 'assistant', type: 'text', text: 'Continuing.' }],
      assistantMeta: meta(),
    }])],
  },

  userCommandMarkup: {
    sessions: [session([{
      blocks: [{
        type: 'text',
        text: '<command-name>/init</command-name><command-args>x</command-args>Actual request',
      }],
      events: [{ role: 'assistant', type: 'text', text: 'Done.' }],
      assistantMeta: meta(),
    }])],
  },

  transferredContext: {
    sessions: [session([{
      blocks: [{
        type: 'text',
        text: '[TRANSFERRED CONTEXT]old stuff[/TRANSFERRED CONTEXT]\n[USER REQUEST]\nThe real question',
      }],
      events: [{ role: 'assistant', type: 'text', text: 'Answered.' }],
      assistantMeta: meta(),
    }])],
  },

  promptWithoutUserBlocks: {
    sessions: [session([
      {
        blocks: [{ type: 'text', text: 'First' }],
        events: [{ role: 'assistant', type: 'text', text: 'First answer' }],
        assistantMeta: meta(),
      },
      {
        blocks: [],
        events: [{ role: 'assistant', type: 'text', text: 'Second answer with no visible prompt' }],
        assistantMeta: meta({ durationSeconds: 1 }),
      },
    ])],
  },

  promptWithoutEvents: {
    sessions: [session([
      {
        blocks: [{ type: 'text', text: 'First' }],
        events: [{ role: 'assistant', type: 'text', text: 'First answer' }],
        assistantMeta: meta(),
      },
      {
        blocks: [{ type: 'text', text: 'Unanswered prompt' }],
        events: [],
        assistantMeta: meta({ durationSeconds: 0 }),
      },
    ])],
  },

  promptWithoutMeta: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'No meta stored' }],
      events: [{ role: 'assistant', type: 'text', text: 'Answer without meta' }],
    }])],
  },

  emptyAssistantText: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'Empty answer' }],
      events: [{ role: 'assistant', type: 'text', text: '' }],
      assistantMeta: meta(),
    }])],
  },

  userRoleEventIsIgnored: {
    sessions: [session([{
      blocks: [{ type: 'text', text: 'Prompt' }],
      events: [
        { role: 'user', type: 'text', text: 'echoed prompt that must not render' },
        { role: 'assistant', type: 'text', text: 'Answer' },
      ],
      assistantMeta: meta(),
    }])],
  },

  multipleSessions: {
    sessions: [
      session([{
        blocks: [{ type: 'text', text: 'Session one' }],
        events: [{ role: 'assistant', type: 'text', text: 'One' }],
        assistantMeta: meta(),
      }], 'session-1'),
      session([{
        blocks: [{ type: 'text', text: 'Session two' }],
        events: [{ role: 'assistant', type: 'text', text: 'Two' }],
        assistantMeta: meta(),
      }], 'session-2'),
    ],
  },

  emptyConversation: { sessions: [] },
};
