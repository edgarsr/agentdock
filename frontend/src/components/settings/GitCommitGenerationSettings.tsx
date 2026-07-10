import { useEffect, useRef, useState } from 'react';
import { GitCommitHorizontal } from 'lucide-react';
import {
  AgentOption,
  GitCommitGenerationSettings as GitCommitGenerationSettingsValue,
  ModelOption
} from '../../types/chat';
import { SettingsToggleCard } from './SettingsToggleCard';
import { DropdownOption, DropdownSelect } from '../ui/DropdownSelect';

interface GitCommitGenerationSettingsProps {
  settings: GitCommitGenerationSettingsValue;
  installedAgents: AgentOption[];
  onChange: (settings: GitCommitGenerationSettingsValue) => void;
}

function resolveModelId(agent: AgentOption | undefined, preferredModelId: string): string {
  const models = agent?.availableModels ?? [];
  if (models.length === 0) return '';
  if (models.some((model) => model.modelId === preferredModelId)) {
    return preferredModelId;
  }
  if (agent?.currentModelId && models.some((model) => model.modelId === agent.currentModelId)) {
    return agent.currentModelId;
  }
  return models[0]?.modelId ?? '';
}

function selectedModelValue(models: ModelOption[], modelId: string): string {
  if (models.some((model) => model.modelId === modelId)) {
    return modelId;
  }
  return models[0]?.modelId ?? '';
}

export function GitCommitGenerationSettings({ settings, installedAgents, onChange }: GitCommitGenerationSettingsProps) {
  if (installedAgents.length === 0) {
    return null;
  }

  const fallbackAgent = installedAgents[0];
  const activeAgent = installedAgents.find((agent) => agent.id === settings.adapterId) ?? fallbackAgent;
  const models = activeAgent?.availableModels ?? [];
  const activeModelId = selectedModelValue(models, settings.modelId);
  const agentOptions: DropdownOption[] = installedAgents.map((agent) => ({
    value: agent.id,
    label: agent.name
  }));
  const modelOptions: DropdownOption[] =
    models.length === 0
      ? [{ value: '', label: 'No models available' }]
      : models.map((model) => ({
          value: model.modelId,
          label: model.name
        }));

  const [localInstructions, setLocalInstructions] = useState(settings.instructions);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalInstructions(settings.instructions);
    }
  }, [settings.instructions]);

  const update = (next: Partial<GitCommitGenerationSettingsValue>) => {
    onChange({
      ...settings,
      ...next
    });
  };

  const handleToggle = () => {
    if (settings.enabled) {
      update({ enabled: false });
      return;
    }

    update({
      enabled: true,
      adapterId: activeAgent?.id ?? '',
      modelId: resolveModelId(activeAgent, settings.modelId)
    });
  };

  const handleAgentChange = (adapterId: string) => {
    const nextAgent = installedAgents.find((agent) => agent.id === adapterId) ?? installedAgents[0];
    update({
      adapterId,
      modelId: resolveModelId(nextAgent, settings.modelId)
    });
  };

  const handleInstructionsBlur = () => {
    isFocusedRef.current = false;
    update({ instructions: localInstructions });
  };

  return (
    <SettingsToggleCard
      icon={GitCommitHorizontal}
      title='Git Commit Message Generation'
      description='Generate commit messages using an installed agent'
      enabled={settings.enabled}
      onToggle={handleToggle}
      ariaLabel='Enable Git commit generation'
      className='justify-center'
    >
      {settings.enabled && (
        <div className='grid max-w-[560px] grid-cols-1 items-center gap-x-3 gap-y-2 min-[420px]:grid-cols-[88px_minmax(0,260px)]'>
          <span className='text-ide-small text-foreground-secondary'>AI Agent</span>
          <div>
            <DropdownSelect
              value={activeAgent?.id ?? ''}
              onChange={handleAgentChange}
              options={agentOptions}
              className='w-full'
            />
          </div>

          <span className='text-ide-small text-foreground-secondary'>Model</span>
          <div>
            <DropdownSelect
              value={activeModelId}
              onChange={(modelId) => update({ modelId })}
              disabled={models.length === 0}
              options={modelOptions}
              className='w-full'
            />
          </div>

          <span className='self-start pt-2 text-ide-small text-foreground-secondary'>Instructions</span>
          <div className='min-w-0'>
            <textarea
              value={localInstructions}
              onChange={(event) => setLocalInstructions(event.target.value)}
              onFocus={() => {
                isFocusedRef.current = true;
              }}
              onBlur={handleInstructionsBlur}
              rows={5}
              placeholder='Describe how commit messages should be written.'
              aria-label='Custom commit message instructions'
              className='w-full resize-none rounded-[4px] px-3 py-2 text-ide-small'
            />
            <div className='mt-1 text-xs text-foreground-secondary'>Optional</div>
          </div>
        </div>
      )}
    </SettingsToggleCard>
  );
}
