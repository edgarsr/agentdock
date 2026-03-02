import React, { useMemo } from 'react';
import { PlanBlock, PlanEntry } from '../../../types/chat';
import {
  ClipboardList,
  CheckCircle2,
  Circle,
  Clock,
  ChevronRight,
  AlertCircle,
  Loader2
} from 'lucide-react';

interface Props {
  block: PlanBlock;
}

export const PlanBlockComponent: React.FC<Props> = ({ block }) => {
  const { entries } = block;

  const allCompleted = entries.length > 0 && entries.every(e => e.status === 'completed');
  const hasInProgress = entries.some(e => e.status === 'in_progress');
  const hasFailed = entries.some(e => e.status === 'failed');

  const currentTaskIndex = useMemo(() => {
    const idx = entries.findIndex(e => e.status === 'in_progress');
    if (idx !== -1) return idx;
    const pendingIdx = entries.findIndex(e => e.status === 'pending');
    return pendingIdx === -1 ? entries.length - 1 : pendingIdx;
  }, [entries]);

  const currentTask = entries[currentTaskIndex];

  // Expanded when no task is actively running (initial plan or all completed)
  // Collapsed while work is in progress
  const [userToggled, setUserToggled] = React.useState(false);
  const [userExpanded, setUserExpanded] = React.useState(false);
  const autoExpanded = !hasInProgress;
  const expanded = userToggled ? userExpanded : autoExpanded;

  // Reset user override when auto-state changes (e.g., task starts/completes)
  React.useEffect(() => {
    setUserToggled(false);
  }, [hasInProgress, allCompleted]);

  const toggleExpanded = () => {
    setUserToggled(true);
    setUserExpanded(!expanded);
  };

  const getStatusIcon = (status: PlanEntry['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 size={14} className="text-green-500" />;
      case 'in_progress':
        return <Loader2 size={14} className="text-blue-500 animate-spin" />;
      case 'pending':
        return <Circle size={14} className="text-editor-fg opacity-40" />;
      case 'failed':
        return <AlertCircle size={14} className="text-error" />;
      case 'cancelled':
        return <Clock size={14} className="text-editor-fg opacity-30" />;
      default:
        return <Circle size={14} className="text-editor-fg opacity-40" />;
    }
  };

  const renderHeaderText = () => {
    if (allCompleted) {
      return <span>All tasks completed</span>;
    }
    if (hasInProgress) {
      return (
        <>
          <span className="opacity-50 mr-2">
            Task {currentTaskIndex + 1} of {entries.length}
          </span>
          {currentTask?.content || 'Executing...'}
        </>
      );
    }
    return <span>Implementation plan</span>;
  };

  return (
    <div className="my-2 border border-border rounded-md overflow-hidden shadow-sm">
      <button
        onClick={toggleExpanded}
        className="flex items-center gap-2 w-full px-3 py-2 bg-editor-bg hover:bg-secondary transition-colors group border-b border-border"
      >
        <div className="flex-shrink-0 text-editor-fg opacity-70">
          <ClipboardList size={14} />
        </div>
        
        <div className="flex-1 text-left font-medium truncate text-editor-fg opacity-90 pr-2">
          {renderHeaderText()}
        </div>

        <div className="flex-shrink-0 flex items-center gap-2">
          {hasFailed && (
            <div className="w-2.5 h-2.5 rounded-full bg-error" />
          )}
          <div className={`transition-transform duration-200 text-editor-fg opacity-50 ${expanded ? 'rotate-90' : ''}`}>
            <ChevronRight size={14} />
          </div>
        </div>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out overflow-hidden"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="p-3 bg-editor-bg space-y-2">
            {entries.map((entry, idx) => (
              <div key={idx} className="flex gap-3 items-start group">
                <div className="mt-0.5 flex-shrink-0">
                  {getStatusIcon(entry.status)}
                </div>
                <div className={`leading-relaxed ${entry.status === 'completed' ? 'opacity-50 line-through' : 'text-editor-fg opacity-90'}`}>
                  {entry.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
