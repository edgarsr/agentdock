import { ChatAttachment, RichContentBlock } from '../../types/chat';

export interface QueuedPrompt {
  id: string;
  text: string;
  composerText: string;
  blocks: RichContentBlock[];
  attachments: ChatAttachment[];
}

export interface QueuePromptDraft {
  text: string;
  composerText: string;
  blocks: RichContentBlock[];
  attachments: ChatAttachment[];
}
