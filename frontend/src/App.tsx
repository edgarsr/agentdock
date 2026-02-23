import { useState, useEffect } from 'react';
import { ChatView } from './views/ChatView';
import { DesignSystemView } from './views/DesignSystemView';
import { AgentManagementView } from './views/AgentManagementView';


function App() {
  const [currentView, setCurrentView] = useState<'chat' | 'demo' | 'management'>('chat');

  useEffect(() => {
    const handleSetView = (view: string) => {
      if (view === 'chat' || view === 'demo' || view === 'management') {
        setCurrentView(view);
      }
    };

    window.setView = handleSetView;
    console.log("UnifiedLLM Frontend Ready");

    return () => {
      delete window.setView;
    };
  }, []);

  return (
    <div className="h-screen bg-background text-foreground overflow-hidden flex flex-col">
      <div className={currentView === 'chat' ? 'flex-1 min-h-0' : 'hidden'}>
        <ChatView />
      </div>
      <div className={currentView === 'demo' ? 'flex-1 min-h-0' : 'hidden'}>
        <DesignSystemView />
      </div>
      <div className={currentView === 'management' ? 'flex-1 min-h-0' : 'hidden'}>
        <AgentManagementView />
      </div>
    </div>
  );
}

export default App
