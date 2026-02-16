import { useState, useEffect, useRef } from 'react';

export interface AcpLogEntryPayload {
  direction: 'SENT' | 'RECEIVED';
  json: string;
  timestamp: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

declare global {
  interface Window {
    __startAgent?: () => void;
    __sendPrompt?: (message: string) => void;
    __notifyReady?: () => void;
    __onAcpLog?: (payload: AcpLogEntryPayload) => void;
    __onAgentText?: (text: string) => void;
    __onStatus?: (status: string) => void;
    __onSessionId?: (id: string) => void;
  }
}

export function ChatView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [status, setStatus] = useState<string>('not started');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentAgentMessageRef = useRef<string>('');
  const pendingMessageRef = useRef<string | null>(null);

  useEffect(() => {
    // Setup bridge callbacks
    window.__onAcpLog = (payload: AcpLogEntryPayload) => {
      // Log all JSON to console for Chromium Developer Tools
      try {
        const jsonObj = JSON.parse(payload.json);
        console.log(`[ACP ${payload.direction}]`, jsonObj);
      } catch (e) {
        console.log(`[ACP ${payload.direction}]`, payload.json);
      }
    };

    window.__onAgentText = (text: string) => {
      // Accumulate agent text chunks
      currentAgentMessageRef.current += text;
      // Update the last message if it's from assistant
      // Only update if we have actual content (not empty string)
      if (currentAgentMessageRef.current.trim()) {
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, content: currentAgentMessageRef.current },
            ];
          }
          return prev;
        });
      }
    };

    window.__onStatus = (s: string) => {
      setStatus(s);
      // When status changes to ready, mark agent message as complete and reset sending state
      if (s === 'ready') {
        // If we have accumulated agent text, ensure it's in the message
        // Only update if we have actual content
        const accumulatedText = currentAgentMessageRef.current.trim();
        if (accumulatedText) {
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              // Only update if the accumulated text is different from what's already there
              if (lastMsg.content !== accumulatedText) {
                return [
                  ...prev.slice(0, -1),
                  { ...lastMsg, content: accumulatedText },
                ];
              }
            }
            return prev;
          });
        }
        // Clear accumulated text after updating message
        currentAgentMessageRef.current = '';
        
        // Reset sending state if no pending message
        if (!pendingMessageRef.current) {
          setIsSending(false);
        }
      }
      // If agent becomes ready and we have a pending message, send it
      if (s === 'ready' && pendingMessageRef.current && typeof window.__sendPrompt === 'function') {
        const messageToSend = pendingMessageRef.current;
        pendingMessageRef.current = null;
        setIsSending(true);
        
        // Add user message
        const userMessage: Message = {
          id: `msg-${Date.now()}-user`,
          role: 'user',
          content: messageToSend,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userMessage]);
        currentAgentMessageRef.current = '';
        
        // Create placeholder for assistant message
        const assistantMessage: Message = {
          id: `msg-${Date.now()}-assistant`,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        
        try {
          window.__sendPrompt(messageToSend);
        } catch (e) {
          console.error('[ChatView] Failed to send pending prompt:', e);
          setIsSending(false);
        }
      }
    };

    window.__onSessionId = (id: string) => {
      // Session ID is available but not currently displayed in UI
      console.debug('[ChatView] Session ID:', id);
    };

    // Notify bridge that we're ready
    if (typeof window.__notifyReady === 'function') {
      window.__notifyReady();
    }

    return () => {
      window.__onAcpLog = undefined;
      window.__onAgentText = undefined;
      window.__onStatus = undefined;
      window.__onSessionId = undefined;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isSending) return;

    // Auto-start agent if not ready
    if (status !== 'ready') {
      if (typeof window.__startAgent !== 'function') {
        console.error('[ChatView] Bridge not ready. Cannot start agent.');
        return;
      }
      setIsSending(true);
      setInputValue('');
      // Store message to send after agent is ready
      pendingMessageRef.current = text;
      try {
        window.__startAgent();
        // Message will be sent automatically when status becomes 'ready' (handled in __onStatus callback)
        return;
      } catch (e) {
        setIsSending(false);
        pendingMessageRef.current = null;
        console.error('[ChatView] Failed to start agent:', e);
        return;
      }
    }

    // Agent is ready, send message directly
    if (typeof window.__sendPrompt !== 'function') {
      console.error('[ChatView] Bridge not ready. Cannot send prompt.');
      return;
    }

    setIsSending(true);
    
    // Add user message
    const userMessage: Message = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    currentAgentMessageRef.current = '';
    
    // Create placeholder for assistant message
    const assistantMessage: Message = {
      id: `msg-${Date.now()}-assistant`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    
    try {
      window.__sendPrompt(text);
    } catch (e) {
      console.error('[ChatView] Failed to send prompt:', e);
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground animate-in slide-in-from-bottom-4 duration-500">
      {/* Chat History Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Welcome message - only show if no messages */}
          {messages.length === 0 && (
            <>
              <div className="bg-surface border border-border p-4 rounded-ide shadow-sm">
                <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                  AI Assistant Ready
                </h2>
                <p className="text-sm opacity-70 leading-relaxed">
                  Hello! I'm your Unified LLM assistant. How can I help you with your code today?
                </p>
              </div>

              <div className="flex justify-center">
                <div className="text-[10px] uppercase tracking-widest opacity-30 border-t border-border w-full text-center pt-2">
                  Today
                </div>
              </div>
            </>
          )}

          {/* Messages */}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-ide p-4 ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-surface border border-border'
                }`}
              >
                <div className="text-sm whitespace-pre-wrap break-words">
                  {message.content || (
                    <span className="opacity-50 italic">Thinking...</span>
                  )}
                </div>
              </div>
            </div>
          ))}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-border bg-surface/30 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto relative">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={3}
            placeholder="Ask me anything..."
            disabled={isSending}
            className="w-full p-4 pr-12 bg-input border border-border rounded-ide focus:ring-2 focus:ring-ring outline-none transition-all resize-none shadow-inner disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending}
            aria-label="Send message"
            className="absolute right-3 bottom-3 p-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
        <div className="mt-2 text-[10px] text-center opacity-30 uppercase tracking-widest">
          Press Enter to send / Shift + Enter for new line
        </div>
      </div>
    </div>
  );
}
