import { useState, useEffect } from 'react';
import { ChatView } from './views/ChatView';
import { DesignSystemView } from './views/DesignSystemView';

function App() {
  const [currentView, setCurrentView] = useState<'chat' | 'demo'>('chat');

  useEffect(() => {
    const handleSetView = (view: string) => {
      if (view === 'chat' || view === 'demo') {
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
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      {currentView === 'chat' && <ChatView />}
      {currentView === 'demo' && <DesignSystemView />}
    </div>
  );
}

export default App
