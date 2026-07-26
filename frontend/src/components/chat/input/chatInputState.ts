import {
  ApprovalMode,
  AudioTranscriptionFeatureState,
  AvailableCommand,
  ChatAttachment,
  ConfigOption,
  DropdownOption,
} from '../../../types/chat';

export interface ChatInputProps {
  conversationId: string;
  contextTokensUsed?: number;
  contextWindowSize?: number;
  inputValue: string;
  onInputChange: (val: string) => void;
  onSend: () => void;
  onQueueDraft?: () => void;
  onStop: () => void;
  isSending: boolean;
  promptQueueEnabled?: boolean;
  agentOptions: DropdownOption[];
  selectedAgentId: string;
  onAgentChange: (id: string) => void;
  selectedModelId: string;
  onModelChange: (id: string, targetAgentId?: string) => void;
  usageSessionKey?: string;
  status: string;
  modeOptions: DropdownOption[];
  selectedModeId: string;
  onModeChange: (id: string) => void;
  reasoningEffortOptions: DropdownOption[];
  selectedReasoningEffortId: string;
  onReasoningEffortChange: (id: string) => void;
  additionalConfigOptions: ConfigOption[];
  onConfigOptionChange: (configId: string, value: string) => void;
  approvalMode: ApprovalMode;
  onApprovalModeChange: (mode: ApprovalMode) => void;
  hasSelectedAgent: boolean;
  availableCommands: AvailableCommand[];
  attachments: ChatAttachment[];
  onAttachmentsChange: (items: ChatAttachment[]) => void;
  onImageClick: (src: string) => void;
  onHeightChange?: (contentHeight: number) => void;
  customHeight?: number;
  autoFocus?: boolean;
  isActive?: boolean;
}

export const emptyTranscriptionFeature: AudioTranscriptionFeatureState = {
  id: 'whisper-transcription',
  installed: false,
  installing: false,
  supported: false,
  status: 'Loading',
  installPath: '',
};
