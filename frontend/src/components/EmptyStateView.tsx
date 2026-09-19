import { Bot } from 'lucide-react';
import type { AgentOption } from '../types/chat';
import { sanitizeSvg } from '../utils/sanitizeHtml';
import { Button } from './ui/Button';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { Tooltip } from './chat/shared/Tooltip';

interface EmptyStateViewProps {
  runnableAgents: AgentOption[];
  adaptersResolved: boolean;
  onStartWithAgent: (agentId: string) => void;
  onOpenManagement: () => void;
}

function AgentIcon({ agent }: { agent: AgentOption }) {
  if (agent.iconPath) {
    if (agent.iconPath.startsWith('<svg')) {
      return (
        <div
          className="h-8 w-8 shrink-0 text-foreground [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: sanitizeSvg(agent.iconPath) }}
        />
      );
    }
    return <img src={agent.iconPath} alt="" className="h-8 w-8 shrink-0 object-contain" />;
  }

  return <Bot className="h-8 w-8 shrink-0 text-foreground-secondary" />;
}

export function EmptyStateView({
  runnableAgents,
  adaptersResolved,
  onStartWithAgent,
  onOpenManagement,
}: EmptyStateViewProps) {
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-background">
      {!adaptersResolved ? (
        <div className="flex min-h-full items-center justify-center">
          <div className="flex items-center gap-3 text-foreground-secondary">
            <LoadingSpinner className="h-5 w-5" />
          </div>
        </div>
      ) : (
        <div className="mx-auto flex min-h-full w-full max-w-app-content justify-center px-4 py-8 sm:px-6">
          <div className="flex flex-col items-center text-center relative pt-[10vh]">
            {runnableAgents.length > 0 ? (
              <>
                <div className="text-ide-medium mb-8">Select an AI agent to start a new chat</div>

                <div className="flex flex-wrap items-center justify-center gap-3">
                  {runnableAgents.map((agent) => (
                    <Tooltip key={agent.id} content={agent.name} variant="minimal">
                      <button
                        type="button"
                        onClick={() => onStartWithAgent(agent.id)}
                        className="flex h-14 w-14 items-center justify-center rounded-xl border
                          border-[var(--ide-Button-startBorderColor)] bg-background opacity-80 transition-all duration-150
                          hover:bg-hover focus:outline-none focus:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                      >
                        <AgentIcon agent={agent} />
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="mt-8 max-w-[300px] text-foreground-secondary">
                  Install at least one AI agent from Service Providers to start a new chat.
                </p>
                <div className="mt-6">
                  <Button onClick={onOpenManagement} variant="secondary">Service Providers</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
