import { memo } from 'react';
import { ShieldAlert } from 'lucide-react';
import { PermissionRequest } from '../../types/chat';
import { RequestAction, RequestCard } from './RequestCard';

interface PermissionBarProps {
  request: PermissionRequest;
  onRespond: (decision: string) => void;
}

const PermissionBar = memo(({ request, onRespond }: PermissionBarProps) => {
  // ACP reserves the cancelled outcome for session/cancel, so dismissing picks the agent's own one-time rejection.
  const reject = request.options.find((option) => option.kind === 'reject_once');
  return <RequestCard heading={request.title} icon={<ShieldAlert size={16} />}
    onDismiss={reject ? () => onRespond(reject.optionId) : undefined}>
    <div role="group" aria-label={request.title}>
      {request.options.map((option) => <RequestAction key={option.optionId} label={option.label}
        onSelect={() => onRespond(option.optionId)} />)}
    </div>
  </RequestCard>;
});

export default PermissionBar;
