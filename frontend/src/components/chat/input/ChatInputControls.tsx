import { RefObject } from 'react';
import {
  CornerDownLeft,
  Keyboard as KeyboardIcon,
  ListPlus,
  LoaderCircle,
  Mic,
  Plus,
  SendHorizontal,
  ShieldCheck,
  ShieldQuestion,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import { ApprovalMode, ConfigOption, DropdownOption } from '../../../types/chat';
import { SlashCommandItem } from './slashCommands';
import ChatDropdown from '../ChatDropdown';
import { ChatUsageIndicator } from '../../usage/chat/ChatUsageIndicator';
import { ContextUsageIndicator } from '../shared/ContextUsageIndicator';
import { Tooltip } from '../shared/Tooltip';
import { AdapterUsageLifecycleProvider } from '../../../hooks/useAdapterUsage';

interface ChatInputControlsProps {
  controlsRowRef: RefObject<HTMLDivElement>;
  sendMode: 'enter' | 'ctrl-enter';
  setSendMode: (mode: 'enter' | 'ctrl-enter') => void;
  plusMenuOptions: DropdownOption[];
  conversationId: string;
  agentOptions: DropdownOption[];
  selectedAgentId: string;
  selectedModelId: string;
  selectedModeId: string;
  modeOptions: DropdownOption[];
  selectedReasoningEffortId: string;
  reasoningEffortOptions: DropdownOption[];
  additionalConfigOptions: ConfigOption[];
  approvalMode: ApprovalMode;
  isSending: boolean;
  hasSelectedAgent: boolean;
  status: string;
  usageSessionKey?: string;
  contextTokensUsed?: number;
  contextWindowSize?: number;
  inputValue: string;
  showAuxIndicators: boolean;
  showVoiceButton: boolean;
  isTranscribing: boolean;
  isRecording: boolean;
  agentSlashItems: SlashCommandItem[];
  promptLibrarySlashItems: SlashCommandItem[];
  handleInsertSlashItem: (itemId: string, items: SlashCommandItem[]) => void;
  handleVoiceInput: () => void;
  onAgentChange: (id: string) => void;
  onModelChange: (id: string, targetAgentId?: string) => void;
  onModeChange: (id: string) => void;
  onReasoningEffortChange: (id: string) => void;
  onConfigOptionChange: (configId: string, value: string) => void;
  onApprovalModeChange: (mode: ApprovalMode) => void;
  onSend: () => void;
  onQueueDraft?: () => void;
  onStop: () => void;
  promptQueueEnabled?: boolean;
}

export function ChatInputControls({
  controlsRowRef,
  sendMode,
  setSendMode,
  plusMenuOptions,
  conversationId,
  agentOptions,
  selectedAgentId,
  selectedModelId,
  selectedModeId,
  modeOptions,
  selectedReasoningEffortId,
  reasoningEffortOptions,
  additionalConfigOptions,
  approvalMode,
  isSending,
  hasSelectedAgent,
  status,
  usageSessionKey,
  contextTokensUsed,
  contextWindowSize,
  inputValue,
  showAuxIndicators,
  showVoiceButton,
  isTranscribing,
  isRecording,
  agentSlashItems,
  promptLibrarySlashItems,
  handleInsertSlashItem,
  handleVoiceInput,
  onAgentChange,
  onModelChange,
  onModeChange,
  onReasoningEffortChange,
  onConfigOptionChange,
  onApprovalModeChange,
  onSend,
  onQueueDraft,
  onStop,
  promptQueueEnabled = false,
}: ChatInputControlsProps) {
  const hasInput = !!inputValue.trim();

  return (
    <div ref={controlsRowRef} className="flex flex-wrap items-stretch gap-y-1 px-1 py-1 text-foreground">
      <div className="flex min-w-0 flex-1 items-stretch">
        <ChatDropdown
          value=""
          options={plusMenuOptions}
          placeholder=""
          disabled={false}
          direction="up"
          customTrigger={
            <div className="flex items-center text-ide-small">
              <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
              <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
            </div>
          }
          className="shrink-0"
          onChange={(id) => {
            if (id === 'add-files' && typeof window.__attachFile === 'function') {
              window.__attachFile(conversationId);
            }
          }}
          onSubChange={(parentId, subId) => {
            if (parentId === 'commands') {
              handleInsertSlashItem(subId, agentSlashItems);
              return;
            }

            if (parentId === 'prompt-library') {
              handleInsertSlashItem(subId, promptLibrarySlashItems);
            }
          }}
        />

        <ChatDropdown
          value={selectedAgentId}
          subValue={selectedModelId}
          options={isSending ? agentOptions.filter((option) => option.id === selectedAgentId) : agentOptions}
          placeholder="Select Agent"
          disabled={false}
          showSubValueInTrigger={true}
          onChange={onAgentChange}
          onSubChange={(_agentId, modelId) => onModelChange(modelId, _agentId)}
          className="ml-0.5 flex-1 max-w-max"
        />

        {modeOptions.length > 0 && (
          <ChatDropdown
            value={selectedModeId}
            options={modeOptions}
            placeholder="Mode"
            disabled={!hasSelectedAgent}
            onChange={onModeChange}
            className="ml-0.5 flex-1 max-w-max"
          />
        )}

        {reasoningEffortOptions.length > 0 && (
          <ChatDropdown
            value={selectedReasoningEffortId}
            options={reasoningEffortOptions}
            placeholder="Reasoning"
            disabled={!hasSelectedAgent}
            onChange={onReasoningEffortChange}
            className="ml-0.5 flex-1 max-w-max"
          />
        )}

        <ChatDropdown
          value=""
          subValues={{
            'send-mode': sendMode,
            approvals: approvalMode,
            ...Object.fromEntries(additionalConfigOptions.map((option) => [option.id, option.currentValue])),
          }}
          options={[
            {
              id: 'send-mode',
              label: 'Send mode',
              subOptions: [
                { id: 'enter', label: 'Enter', icon: <CornerDownLeft className="w-4 h-4" /> },
                { id: 'ctrl-enter', label: 'Ctrl+Enter', icon: <KeyboardIcon className="w-4 h-4" /> },
              ],
            },
            {
              id: 'approvals',
              label: 'Approvals',
              subOptions: [
                {
                  id: 'ask',
                  label: 'Ask approvals',
                  description: 'Show agent approval prompts',
                  icon: <ShieldQuestion className="w-4 h-4" />,
                },
                {
                  id: 'auto',
                  label: 'Auto approve',
                  description: 'Automatically approve tool requests when a normal approve option is available',
                  icon: <ShieldCheck className="w-4 h-4" />,
                },
              ],
            },
            ...additionalConfigOptions.map((option) => {
              const values = option.type === 'boolean'
                ? [
                    { id: 'true', label: 'Enabled' },
                    { id: 'false', label: 'Disabled' },
                  ]
                : option.options.map((value) => ({
                    id: value.value,
                    label: value.name,
                    description: value.description,
                  }));

              return {
                id: option.id,
                label: option.name,
                description: option.description,
                subOptions: values,
              };
            }),
          ]}
          placeholder="Options"
          disabled={false}
          customTrigger={
            <Tooltip variant="minimal" content="Options">
              <div className="flex items-center">
                <SlidersHorizontal size={16} aria-hidden="true" />
                <span className="sr-only">Options</span>
              </div>
            </Tooltip>
          }
          onChange={() => {}}
          onSubChange={(parentId, subId) => {
            if (parentId === 'send-mode') {
              setSendMode(subId as 'enter' | 'ctrl-enter');
              localStorage.setItem('chat-send-mode', subId);
            } else if (parentId === 'approvals') {
              onApprovalModeChange(subId as ApprovalMode);
            } else {
              onConfigOptionChange(parentId, subId);
            }
          }}
          className="ml-0.5 mr-1 shrink-0"
        />

        {showAuxIndicators && selectedAgentId && (
          <AdapterUsageLifecycleProvider
            value={{ mode: 'chat', enabled: true, isSending, sessionKey: status === 'ready' ? usageSessionKey : undefined }}
          >
            <ChatUsageIndicator agentId={selectedAgentId} modelId={selectedModelId} />
          </AdapterUsageLifecycleProvider>
        )}

        {showAuxIndicators && <ContextUsageIndicator used={contextTokensUsed} size={contextWindowSize} />}
      </div>

      <div className="ml-auto flex shrink-0 items-stretch">
        {showVoiceButton && (isTranscribing ? (
            <button type="button" disabled={true} className="flex items-center h-full px-1.5 rounded appearance-none
              border-0 bg-editor-bg outline-none text-ide-small text-foreground-secondary
              focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
            >
              <LoaderCircle size={16} className="animate-spin" />
              <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
            </button>
          ) : (
            <button type="button" onClick={handleVoiceInput}
              className={`flex items-center h-full px-1.5 rounded appearance-none border-0 outline-none text-ide-small 
                focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] 
                ${isRecording ? 'bg-[#db5c5c] text-foreground' : 'bg-editor-bg text-foreground hover:text-foreground ' +
                'hover:bg-hover focus-visible:bg-hover focus-visible:text-foreground'}`}
            >
              <Tooltip variant="minimal" content={isRecording ? 'Stop recording' : 'Voice input'}>
                <div className="flex items-center">
                  <Mic size={16} className="block translate-y-px" />
                  <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
                </div>
              </Tooltip>
            </button>
          )
        )}

        {isSending ? (
          <>
          {promptQueueEnabled && hasInput && (
            <button key="queue-button" type="button" onClick={onQueueDraft}
              className={`flex items-center h-full px-1.5 rounded appearance-none border-0 bg-editor-bg outline-none
                text-ide-small focus-visible:bg-hover focus-visible:text-foreground
                focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]
                hover:bg-hover hover:text-foreground text-foreground-secondary`}
            >
              <Tooltip variant="minimal" content="Add to queue">
                <div className="flex items-center">
                  <ListPlus size={16} className="block" strokeWidth={2} />
                  <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
                </div>
              </Tooltip>
            </button>
          )}
          <button key="stop-button" type="button" onClick={onStop}
            className="flex items-center h-full px-1.5 rounded appearance-none border-0 bg-editor-bg
                outline-none text-ide-small text-error hover:bg-hover focus-visible:bg-hover
                focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
          >
            <Tooltip variant="minimal" content="Cancel">
              <div className="flex items-center">
                <Square size={16} aria-hidden="true" />
                <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
              </div>
            </Tooltip>
          </button>
          </>
        ) : (
          <button key="send-button" type="button" onClick={onSend} disabled={!hasInput}
            className={`flex items-center h-full px-1.5 rounded appearance-none border-0 bg-editor-bg outline-none
              text-ide-small focus-visible:bg-hover focus-visible:text-foreground
              focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]
              hover:bg-hover disabled:pointer-events-none hover:text-foreground
              ${hasInput ? 'text-foreground-secondary' : 'text-[var(--ide-Label-disabledForeground)]'}`}
          >
            <Tooltip variant="minimal" content={hasInput ? 'Send' : null}>
              <div className="flex items-center">
                <SendHorizontal size={16} className="block" strokeWidth={2} />
                <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
              </div>
            </Tooltip>
          </button>
        )}
      </div>
    </div>
  );
}
