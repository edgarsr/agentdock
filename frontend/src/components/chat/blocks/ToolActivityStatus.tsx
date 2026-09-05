import { parseToolStatus } from '../../../utils/toolCallUtils';

export function ToolActivityStatus({ status, isActivePrompt }: { status?: string; isActivePrompt: boolean }) {
  const { isPending, isError } = parseToolStatus(status);
  const showPending = isPending && isActivePrompt;
  if (!showPending && !isError) return null;
  return <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${showPending ? 'bg-warning animate-pulse' : 'bg-error'}`} />;
}
