import { useEffect, useRef, useState } from 'react';
import { AgentOption, GitCommitGenerationSettings as GitCommitGenerationSettingsValue } from '../../types/chat';
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
  const agentOptions: DropdownOption[] = installedAgents.map((agent) => ({ value: agent.id, label: agent.name }));
  const modelOptions: DropdownOption[] =
    models.length === 0
      ? [{ value: '', label: 'No models available' }]
      : models.map((model) => ({ value: model.modelId, label: model.name }));

  const update = (next: Partial<GitCommitGenerationSettingsValue>) => onChange({ ...settings, ...next });

  const handleToggle = () =>
    update(
      settings.enabled
        ? { enabled: false }
        : { enabled: true, adapterId: activeAgent.id, modelId: resolveModelId(activeAgent, settings.modelId) }
    );

  const handleAgentChange = (adapterId: string) => {
    const nextAgent = installedAgents.find((agent) => agent.id === adapterId) ?? installedAgents[0];
    update({ adapterId, modelId: resolveModelId(nextAgent, settings.modelId) });
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
              value={resolveModelId(activeAgent, settings.modelId)}
              onChange={(modelId) => update({ modelId })}
              disabled={models.length === 0}
              options={modelOptions}
              className='max-w-full'
            />
          </SettingsField>
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
