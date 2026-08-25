import { useEffect, useRef, useState } from 'react';
import {
  AgentOption,
  ConfigOption,
  GitCommitGenerationSettings as GitCommitGenerationSettingsValue,
} from '../../types/chat';
import { SettingsCheckbox, SettingsField } from './SettingsLayout';
import { DropdownOption, DropdownSelect } from '../ui/DropdownSelect';

interface GitCommitGenerationSettingsProps {
  settings: GitCommitGenerationSettingsValue;
  installedAgents: AgentOption[];
  onChange: (settings: GitCommitGenerationSettingsValue) => void;
}

function resolveModelId(agent: AgentOption | undefined, preferredModelId: string): string {
  const models = agent?.availableModels ?? [];
  const known = (id?: string) => models.some((model) => model.modelId === id);
  return [preferredModelId, agent?.currentModelId].find(known) ?? models[0]?.modelId ?? '';
}

const matches = (option: ConfigOption, category: string) =>
  option.id === category || option.category === category;

const isReasoningEffort = (option: ConfigOption) =>
  matches(option, 'thought_level') || matches(option, 'reasoning_effort');

function resolveReasoningOption(agent: AgentOption | undefined, modelId: string): ConfigOption | undefined {
  const options = agent?.configOptionsByModel?.[modelId] ?? agent?.configOptions ?? [];
  return options.find(isReasoningEffort);
}

function resolveReasoningEffortId(option: ConfigOption | undefined, preferredEffortId: string): string {
  return option?.options.some((effort) => effort.value === preferredEffortId) ? preferredEffortId : '';
}

export function GitCommitGenerationSettings({ settings, installedAgents, onChange }: GitCommitGenerationSettingsProps) {
  const [localInstructions, setLocalInstructions] = useState(settings.instructions);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalInstructions(settings.instructions);
    }
  }, [settings.instructions]);

  if (installedAgents.length === 0) {
    return null;
  }

  const activeAgent = installedAgents.find((agent) => agent.id === settings.adapterId) ?? installedAgents[0];
  const models = activeAgent?.availableModels ?? [];
  const activeModelId = resolveModelId(activeAgent, settings.modelId);
  const reasoningOption = resolveReasoningOption(activeAgent, activeModelId);
  const reasoningEffortId = resolveReasoningEffortId(reasoningOption, settings.reasoningEffortId);
  const agentOptions: DropdownOption[] = installedAgents.map((agent) => ({ value: agent.id, label: agent.name }));
  const modelOptions: DropdownOption[] =
    models.length === 0
      ? [{ value: '', label: 'No models available' }]
      : models.map((model) => ({ value: model.modelId, label: model.name }));
  const reasoningOptions: DropdownOption[] = [
    { value: '', label: 'Default' },
    ...(reasoningOption?.options.map((effort) => ({ value: effort.value, label: effort.name })) ?? []),
  ];

  const update = (next: Partial<GitCommitGenerationSettingsValue>) => onChange({ ...settings, ...next });

  const handleToggle = () =>
    update(
      settings.enabled
        ? { enabled: false }
        : {
            enabled: true,
            adapterId: activeAgent.id,
            modelId: activeModelId,
            reasoningEffortId,
          }
    );

  const handleAgentChange = (adapterId: string) => {
    const nextAgent = installedAgents.find((agent) => agent.id === adapterId) ?? installedAgents[0];
    const modelId = resolveModelId(nextAgent, settings.modelId);
    const effortId = resolveReasoningEffortId(
      resolveReasoningOption(nextAgent, modelId),
      settings.reasoningEffortId,
    );
    update({ adapterId, modelId, reasoningEffortId: effortId });
  };

  const handleModelChange = (modelId: string) => {
    const effortId = resolveReasoningEffortId(
      resolveReasoningOption(activeAgent, modelId),
      settings.reasoningEffortId,
    );
    update({ modelId, reasoningEffortId: effortId });
  };

  return (
    <SettingsCheckbox
      title='Git Commit Message Generation'
      description='Enable the button for AI commit message generation'
      checked={settings.enabled}
      onToggle={handleToggle}
      ariaLabel='Enable Git commit generation'
    >
      {settings.enabled && (
        <>
          <SettingsField label='AI Agent' colon>
            <DropdownSelect
              value={activeAgent.id}
              onChange={handleAgentChange}
              options={agentOptions}
              className='max-w-full'
            />
          </SettingsField>
          <SettingsField label='Model' colon>
            <DropdownSelect
              value={activeModelId}
              onChange={handleModelChange}
              disabled={models.length === 0}
              options={modelOptions}
              className='max-w-full'
            />
          </SettingsField>
          {reasoningOption && reasoningOption.options.length > 0 && (
            <SettingsField label={reasoningOption.name || 'Reasoning Effort'} colon>
              <DropdownSelect
                value={reasoningEffortId}
                onChange={(nextEffortId) => update({ reasoningEffortId: nextEffortId })}
                options={reasoningOptions}
                className='max-w-full'
              />
            </SettingsField>
          )}
          <SettingsField label='Custom Instructions (optional)' stacked>
            <textarea
              value={localInstructions}
              onChange={(event) => setLocalInstructions(event.target.value)}
              onFocus={() => {
                isFocusedRef.current = true;
              }}
              onBlur={() => {
                isFocusedRef.current = false;
                update({ instructions: localInstructions });
              }}
              rows={5}
              placeholder='Describe how commit messages should be written.'
              aria-label='Custom commit message instructions'
              className='w-full max-w-[520px] resize-y rounded-[3px] px-2 py-1'
            />
          </SettingsField>
        </>
      )}
    </SettingsCheckbox>
  );
}
