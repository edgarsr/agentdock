import React, { useMemo } from 'react';
import { Check, ChevronRight, ListChecks } from 'lucide-react';
import { ToolCallBlock } from '../../../types/chat';
import { safeParseJson } from '../../../utils/toolCallUtils';
import { useAutoCollapse } from '../../../hooks/useAutoCollapse';
import { chatInsetFocusClassName } from '../shared/focusStyles';

interface Props {
  block: ToolCallBlock;
}

interface TodoItem {
  content: string;
  status: string;
  priority?: string;
}

export const TodoBlock: React.FC<Props> = ({ block }) => {
  const { isExpanded, toggle } = useAutoCollapse();
  const todos = useMemo(() => extractTodos(block.entry.rawJson), [block.entry.rawJson]);
  const completed = todos.filter((todo) => todo.status === 'completed').length;

  if (todos.length === 0) return null;

  return (
    <div className="border border-border rounded-[6px] overflow-hidden mb-2">
      <button
        onClick={toggle}
        className={`flex items-center gap-2 w-full px-3 h-9 bg-editor-bg ${chatInsetFocusClassName}`}
      >
        <ListChecks size={14} className="text-foreground-secondary" />
        <div className="flex-1 text-left truncate text-editor-fg pr-2">
          {completed}/{todos.length} todos
        </div>
        <div className={`transition-transform duration-200 text-foreground-secondary ${isExpanded ? 'rotate-90' : ''}`}>
          <ChevronRight size={14} />
        </div>
      </button>

      {isExpanded && (
        <div className="p-3 bg-editor-bg space-y-2 border-t border-border">
          {todos.map((todo, index) => (
            <div key={`${todo.content}-${index}`} className="flex items-start gap-2 text-ide-small">
              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${priorityClass(todo.priority)}`}>
                {todo.status === 'completed' && <Check size={12} strokeWidth={3} />}
              </span>
              <span className={todo.status === 'completed' ? 'text-foreground-secondary line-through' : 'text-foreground'}>
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function extractTodos(rawJson: string): TodoItem[] {
  const json = safeParseJson(rawJson);
  const todos = json.rawInput?.todos;
  if (!Array.isArray(todos)) return [];
  return todos.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const todo = item as Record<string, unknown>;
    if (typeof todo.content !== 'string' || typeof todo.status !== 'string') return [];
    return [{
      content: todo.content,
      status: todo.status,
      priority: typeof todo.priority === 'string' ? todo.priority : undefined,
    }];
  });
}

function priorityClass(priority?: string): string {
  switch (priority) {
    case 'high':
      return 'border-red-500 text-red-500';
    case 'medium':
      return 'border-amber-500 text-amber-500';
    case 'low':
      return 'border-green-500 text-green-500';
    default:
      return 'border-foreground-secondary text-foreground-secondary';
  }
}
