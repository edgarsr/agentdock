import { Component, ReactNode, useEffect, useState } from 'react';
import { Button } from './ui/Button';

/** Without it, an error while rendering would leave an empty page; a reload restores the UI. */
class RenderErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-foreground">
        <span className="text-foreground-secondary">Agent Dock stopped after an error</span>
        <Button variant="primary" onClick={() => window.__reloadUi?.()}>Reload</Button>
      </div>
    );
  }
}

/**
 * Shows the UI, or, while another page (the IDE or a browser tab) shows it, an offer to take it over.
 * A browser page that has lost the IDE says so until it reconnects and reloads.
 */
export function UiOwnerGate({ children }: { children: ReactNode }) {
  const [elsewhere, setElsewhere] = useState(() => !!window.__agentDockElsewhere);
  const [disconnected, setDisconnected] = useState(() => !!window.__agentDockDisconnected);

  useEffect(() => {
    const onElsewhere = () => setElsewhere(true);
    const onDisconnected = () => setDisconnected(true);
    window.addEventListener('agent-dock-elsewhere', onElsewhere);
    window.addEventListener('agent-dock-disconnected', onDisconnected);
    if (window.__agentDockElsewhere) onElsewhere();
    if (window.__agentDockDisconnected) onDisconnected();
    return () => {
      window.removeEventListener('agent-dock-elsewhere', onElsewhere);
      window.removeEventListener('agent-dock-disconnected', onDisconnected);
    };
  }, []);

  if (elsewhere) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-foreground">
        <span className="text-foreground-secondary">Agent Dock is open elsewhere</span>
        <Button variant="primary" onClick={() => window.__takeOverUi?.()}>Take over here</Button>
      </div>
    );
  }

  if (disconnected) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground-secondary">
        The IDE is not reachable
      </div>
    );
  }

  return <RenderErrorBoundary>{children}</RenderErrorBoundary>;
}
