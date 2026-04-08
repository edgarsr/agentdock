import { useState, useEffect } from 'react';

interface ChatLoadingIndicatorProps {
  status: string | undefined;
  agentName: string | undefined;
}

const SpinnerIcon = ({ size = 16 }: { size?: number }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    xmlns="http://www.w3.org/2000/svg" 
    className="animate-spin"
  >
    <style>{`
      .spinner_V8m1{transform-origin:center;animation:spinner_z7kP .75s infinite linear}
      @keyframes spinner_z7kP{100%{transform:rotate(360deg)}}
    `}</style>
    <path 
      d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z" 
      opacity=".25" 
      fill="currentColor"
    />
    <path 
      d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z" 
      fill="currentColor"
    />
  </svg>
);

export function ChatLoadingIndicator({ status, agentName }: ChatLoadingIndicatorProps) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    // Only count if we've passed initialization
    if (status !== 'initializing') {
      const interval = setInterval(() => {
        setSeconds(prev => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setSeconds(0);
    }
  }, [status]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    
    if (mins === 0) {
      return `${secs}s`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isInitializing = status === 'initializing';

  return (
    <div className="flex items-center mt-4 gap-3 text-foreground-secondary text-ide-small animate-in fade-in duration-300">
      <div className="flex-shrink-0 mt-[-2px]"><SpinnerIcon /></div>
      <div className="flex items-center">
        <span>{isInitializing && `Connect to ${agentName || 'agent'}...`}</span>
        {!isInitializing && (<span className="tabular-nums">{formatTime(seconds)}</span>)}
      </div>
    </div>
  );
}
