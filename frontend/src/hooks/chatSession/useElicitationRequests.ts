import { useEffect, useState } from 'react';
import { ElicitationRequest } from '../../types/elicitation';
import { ACPBridge } from '../../utils/bridge';

export function useElicitationRequests(conversationId: string) {
  const [requests, setRequests] = useState<ElicitationRequest[]>([]);
  useEffect(() => {
    const unsubscribe = ACPBridge.onElicitationRequests((event) => {
      if (event.detail.chatId === conversationId) setRequests(event.detail.requests);
    });
    const unsubscribeAttached = ACPBridge.onChatAttached((event) => {
      if (event.detail.payload.chatId === conversationId) setRequests(event.detail.payload.elicitations ?? []);
    });
    return () => { unsubscribe(); unsubscribeAttached(); };
  }, [conversationId]);
  return requests[0] ?? null;
}
