import { ReactNode, RefObject, useEffect, useState } from 'react';
import {
  AlarmClockOff,
  CornerDownLeft,
  Clock,
  Ellipsis,
  Keyboard as KeyboardIcon,
  Link2,
  Link2Off,
  ListPlus,
  Plus,
  SendHorizontal,
  ShieldCheck,
  ShieldQuestion,
  Square,
  Zap,
} from 'lucide-react';
import { ApprovalMode, ConfigOption, DropdownOption } from '../../../types/chat';
import { SlashCommandItem } from './slashCommands';
import ChatDropdown from '../ChatDropdown';
import { ChatUsageIndicator } from '../../usage/chat/ChatUsageIndicator';
import { ContextUsageIndicator } from '../shared/ContextUsageIndicator';
import { Tooltip } from '../shared/Tooltip';
import { AdapterUsageLifecycleProvider } from '../../../hooks/useAdapterUsage';
import { findReasoningEffortOption } from '../../../utils/configOptions';
import { ACPBridge } from '../../../utils/bridge';

interface ChatInputControlsProps {
  containerRef: RefObject<HTMLDivElement>;
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
  isActive: boolean;
  contextTokensUsed?: number;
  contextWindowSize?: number;
  inputValue: string;
  voiceInputButton: ReactNode;
  agentSlashItems: SlashCommandItem[];
  promptLibrarySlashItems: SlashCommandItem[];
  handleInsertSlashItem: (itemId: string, items: SlashCommandItem[]) => void;
  onAgentChange: (id: string) => void;
  onModelChange: (id: string, targetAgentId?: string) => void;
  onModeChange: (id: string) => void;
  onReasoningEffortChange: (id: string) => void;
  onConfigOptionChange: (configId: string, value: string) => void;
  onApprovalModeChange: (mode: ApprovalMode) => void;
  onSend: () => void;
  onStop: () => void;
  scheduleEnabled?: boolean;
  onScheduleModeChange?: (enabled: boolean) => void;
  hasAttachments?: boolean;
}

export function ChatInputControls({
  containerRef,
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
  isActive,
  contextTokensUsed,
  contextWindowSize,
  inputValue,
  voiceInputButton,
  agentSlashItems,
  promptLibrarySlashItems,
  handleInsertSlashItem,
  onAgentChange,
  onModelChange,
  onModeChange,
  onReasoningEffortChange,
  onConfigOptionChange,
  onApprovalModeChange,
  onSend,
  onStop,
  scheduleEnabled = false,
  onScheduleModeChange,
  hasAttachments = false,
}: ChatInputControlsProps) {
  const hasInput = !!inputValue.trim() || hasAttachments;
  const [rememberModelAndEffort, setRememberModelAndEffort] = useState(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.rememberModelAndEffort ?? false
  );
  useEffect(() => ACPBridge.onGlobalSettings((e) => {
    setRememberModelAndEffort(e.detail?.payload?.settings?.rememberModelAndEffort ?? false);
  }), []);
  const fastModeOption = additionalConfigOptions.find((option) => {
    if ((option.id !== 'fast' && option.id !== 'fast-mode') || option.type !== 'select' || option.options.length !== 2) return false;
    const values = option.options.map((value) => value.value);
    return (values.includes('on') && values.includes('off'))
      || (values.includes('true') && values.includes('false'));
  });
  const fastModeOnValue = fastModeOption?.options.find((value) => value.value === 'on' || value.value === 'true')?.value;
  const fastModeOffValue = fastModeOption?.options.find((value) => value.value === 'off' || value.value === 'false')?.value;
  const fastModeEnabled = fastModeOption?.currentValue === 'on' || fastModeOption?.currentValue === 'true';
  const fastModeDescription = fastModeOption?.options.find((value) => value.value === fastModeOption?.currentValue)?.description
    ?? (fastModeEnabled ? fastModeOption?.description : undefined);
  const modeOption = additionalConfigOptions.find((option) => option.id === 'mode')
    ?? additionalConfigOptions.find((option) => option.category === 'mode');
  const effortOption = findReasoningEffortOption(additionalConfigOptions);
  const narrowOnlyOptions = [
    modeOptions.length > 0 && modeOption,
    reasoningEffortOptions.length > 0 && effortOption,
    fastModeOnValue && fastModeOffValue && fastModeOption,
  ];

  return (
    <div className="flex flex-wrap items-stretch gap-y-1 px-1 pt-[5px] pb-[3px] text-foreground">
      <div className="flex min-w-0 flex-1 items-stretch">
        <ChatDropdown
          containerRef={containerRef}
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
          containerRef={containerRef}
          value={selectedAgentId}
          subValue={selectedModelId}
          options={isSending ? agentOptions.filter((option) => option.id === selectedAgentId) : agentOptions}
          placeholder="Select Agent"
          triggerTooltip="Model"
          disabled={false}
          showSubValueInTrigger={true}
          onChange={onAgentChange}
          onSubChange={(_agentId, modelId) => onModelChange(modelId, _agentId)}
          className="ml-0.5 flex-1 max-w-max"
        />

        {modeOptions.length > 0 && (
          <ChatDropdown
            containerRef={containerRef}
            value={selectedModeId}
            options={modeOptions}
            placeholder="Mode"
            triggerTooltip="Mode"
            menuTitle="Mode"
            disabled={!hasSelectedAgent}
            onChange={onModeChange}
            className="ml-0.5 flex-1 max-w-max chat-max-400:hidden"
          />
        )}

        {reasoningEffortOptions.length > 0 && (
          <ChatDropdown
            containerRef={containerRef}
            value={selectedReasoningEffortId}
            options={reasoningEffortOptions}
            placeholder="Reasoning"
            triggerTooltip="Effort"
            menuTitle="Effort"
            disabled={!hasSelectedAgent}
            onChange={onReasoningEffortChange}
            className="ml-0.5 flex-1 max-w-max chat-max-400:hidden"
          />
        )}

        {fastModeOption && fastModeOnValue && fastModeOffValue && (
          <Tooltip variant="minimal" className="ml-0.5 flex chat-max-400:hidden" content={`Fast mode: ${fastModeEnabled ? 'On' : 'Off'}${fastModeDescription ? `, ${fastModeDescription}` : ''}`}>
            <button
              type="button"
              disabled={!hasSelectedAgent}
              aria-label="Fast mode"
              aria-pressed={fastModeEnabled}
              onClick={() => onConfigOptionChange(fastModeOption.id, fastModeEnabled ? fastModeOffValue : fastModeOnValue)}
              className={`flex shrink-0 items-center rounded border-0 bg-background-secondary px-1.5 outline-none
                focus-visible:relative focus-visible:z-10
                hover:bg-hover focus-visible:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-[var(--ide-Button-default-focusColor)]
                disabled:cursor-not-allowed ${fastModeEnabled ? 'text-link' : 'text-foreground'}`}
            >
              <Zap size={15} fill={fastModeEnabled ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
          </Tooltip>
        )}
        <ChatDropdown
          containerRef={containerRef}
          value=""
          subValues={{
            'schedule-send': scheduleEnabled ? 'on' : 'off',
            'send-mode': sendMode,
            approvals: approvalMode,
            'remember-model-and-effort': rememberModelAndEffort ? 'on' : 'off',
            ...Object.fromEntries(additionalConfigOptions.map((option) => [option.id, option.currentValue])),
          }}
          options={[
            ...(onScheduleModeChange ? [{
              id: 'schedule-send',
              label: 'Schedule send',
              subOptions: [
                { id: 'on', label: 'On', icon: <Clock className="w-4 h-4" /> },
                { id: 'off', label: 'Off', icon: <AlarmClockOff className="w-4 h-4" /> },
              ],
            }] : []),
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
            {
              id: 'remember-model-and-effort',
              label: 'Remember',
              subOptions: [
                {
                  id: 'on',
                  label: 'Model & effort',
                  description: "Auto-selects the mode's last model and the model's last effort",
                  icon: <Link2 className="w-4 h-4" />,
                },
                { id: 'off', label: 'Off', icon: <Link2Off className="w-4 h-4" /> },
              ],
            },
            ...additionalConfigOptions.filter((option) => hasSelectedAgent || !narrowOnlyOptions.includes(option)).map((option) => {
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
                className: narrowOnlyOptions.includes(option) ? 'hidden chat-max-400:block' : undefined,
                subOptions: values,
              };
            }),
          ]}
          placeholder="Options"
          triggerTooltip="Options"
          disabled={false}
          customTrigger={
            <div className="flex items-center">
              <Ellipsis size={16} aria-hidden="true" />
              <span className="sr-only">Options</span>
            </div>
          }
          onChange={() => {}}
          onSubChange={(parentId, subId) => {
            if (parentId === 'schedule-send') {
              onScheduleModeChange?.(subId === 'on');
            } else if (parentId === 'send-mode') {
              setSendMode(subId as 'enter' | 'ctrl-enter');
            } else if (parentId === 'approvals') {
              onApprovalModeChange(subId as ApprovalMode);
            } else if (parentId === 'remember-model-and-effort') {
              setRememberModelAndEffort(subId === 'on');
              ACPBridge.saveGlobalSettings({ rememberModelAndEffort: subId === 'on' });
            } else {
              onConfigOptionChange(parentId, subId);
            }
          }}
          className="shrink-0"
        />
      </div>

      <div className="ml-auto flex shrink-0 items-stretch">
        {selectedAgentId && (
          <AdapterUsageLifecycleProvider value={{ mode: 'chat', enabled: isActive, isSending }}>
            <ChatUsageIndicator agentId={selectedAgentId} modelId={selectedModelId} />
          </AdapterUsageLifecycleProvider>
        )}

        <ContextUsageIndicator used={contextTokensUsed} size={contextWindowSize} />

        {voiceInputButton}

        {isSending ? (
          <>
          {hasInput && (
            <Tooltip variant="minimal" content="Add to queue" className="h-full">
              <button key="queue-button" type="button" onClick={onSend} aria-label="Add to queue"
                className={`flex items-center h-full px-1.5 rounded appearance-none border-0 bg-background-secondary outline-none
                  text-ide-small focus-visible:bg-hover focus-visible:text-foreground
                  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]
                  hover:bg-hover hover:text-foreground text-foreground-secondary`}
              >
                <div className="flex items-center">
                  <ListPlus size={16} className="block" strokeWidth={2} />
                  <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
                </div>
              </button>
            </Tooltip>
          )}
          <Tooltip variant="minimal" content="Cancel" className="h-full">
            <button key="stop-button" type="button" onClick={onStop} aria-label="Cancel"
              className="flex items-center h-full px-1.5 rounded appearance-none border-0 bg-background-secondary
                  outline-none text-ide-small text-error hover:bg-hover focus-visible:bg-hover
                  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
            >
              <div className="flex items-center">
                <Square size={15} className="relative -top-px" aria-hidden="true" />
                <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
              </div>
            </button>
          </Tooltip>
          </>
        ) : (
          <Tooltip variant="minimal" content={hasInput ? 'Send' : null} className="h-full">
            <button key="send-button" type="button" onClick={onSend} disabled={!hasInput} aria-label="Send"
              className={`flex items-center h-full px-1.5 rounded appearance-none border-0 bg-background-secondary outline-none
                text-ide-small focus-visible:bg-hover focus-visible:text-foreground
                focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]
                hover:bg-hover disabled:pointer-events-none hover:text-foreground
                ${hasInput ? 'text-foreground-secondary' : 'text-[var(--ide-Label-disabledForeground)]'}`}
            >
              <div className="flex items-center">
                <SendHorizontal size={15} className="block" strokeWidth={2} />
                <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
              </div>
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
