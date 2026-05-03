import { RefObject } from 'react';
import {
  LoaderCircle,
  Mic,
  Plus,
  SendHorizontal,
  Square,
} from 'lucide-react';
import { DropdownOption } from '../../../types/chat';
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
  isSending: boolean;
  hasSelectedAgent: boolean;
  status: string;
  usageSessionKey?: string;
  contextTokensUsed?: number;
  contextWindowSize?: number;
  inputValue: string;
  collapsedAgentDropdown: boolean;
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
  onSend: () => void;
  onStop: () => void;
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
  isSending,
  hasSelectedAgent,
  status,
  usageSessionKey,
  contextTokensUsed,
  contextWindowSize,
  inputValue,
  collapsedAgentDropdown,
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
  onSend,
  onStop,
}: ChatInputControlsProps) {
  const hasInput = !!inputValue.trim();

  return (
    <div ref={controlsRowRef} className="flex flex-wrap items-stretch gap-y-1 px-1 py-1 text-foreground">
      <div className="flex min-w-0 flex-1 items-stretch">
        <ChatDropdown
          value="send-mode"
          subValue={sendMode}
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
          onChange={(id) => {
            if (id === 'add-files' && typeof window.__attachFile === 'function') {
              window.__attachFile(conversationId);
            }
          }}
          onSubChange={(parentId, subId) => {
            if (parentId === 'send-mode') {
              setSendMode(subId as 'enter' | 'ctrl-enter');
              localStorage.setItem('chat-send-mode', subId);
              return;
            }

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
          options={agentOptions}
          placeholder="Select Agent"
          disabled={isSending}
          collapsed={collapsedAgentDropdown}
          showSubValueInTrigger={true}
          onChange={onAgentChange}
          onSubChange={(_agentId, modelId) => onModelChange(modelId, _agentId)}
          className="ml-0.5"
        />

        {modeOptions.length > 0 && (
          <ChatDropdown
            value={selectedModeId}
            options={modeOptions}
            placeholder="Mode"
            disabled={isSending || !hasSelectedAgent}
            onChange={onModeChange}
            className="ml-0.5"
          />
        )}

        {showAuxIndicators && selectedAgentId && (
          <AdapterUsageLifecycleProvider
            value={{enabled: true, isSending, sessionKey: status === 'ready' ? usageSessionKey : undefined,}}
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
            <button type="button" onClick={handleVoiceInput} disabled={isSending}
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
