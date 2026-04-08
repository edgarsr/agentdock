import { GitCommitHorizontal } from 'lucide-react';
import { AgentOption, GitCommitGenerationSettings as GitCommitGenerationSettingsValue, ModelOption } from '../../types/chat';
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

export function GitCommitGenerationSettings({
  settings,
  installedAgents,
  onChange,
}: GitCommitGenerationSettingsProps) {
  if (installedAgents.length === 0) {
    return null;
  }

  const fallbackAgent = installedAgents[0];
  const activeAgent = installedAgents.find((agent) => agent.id === settings.adapterId) ?? fallbackAgent;
  const models = activeAgent?.availableModels ?? [];
  const activeModelId = selectedModelValue(models, settings.modelId);
  const agentOptions: DropdownOption[] = installedAgents.map((agent) => ({
    value: agent.id,
    label: agent.name,
  }));
  const modelOptions: DropdownOption[] = models.length === 0
    ? [{ value: '', label: 'No models available' }]
    : models.map((model) => ({
        value: model.modelId,
        label: model.name,
      }));

  const update = (next: Partial<GitCommitGenerationSettingsValue>) => {
    onChange({
      ...settings,
      ...next,
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
      modelId: resolveModelId(activeAgent, settings.modelId),
    });
  };

  const handleAgentChange = (adapterId: string) => {
    const nextAgent = installedAgents.find((agent) => agent.id === adapterId) ?? installedAgents[0];
    update({
      adapterId,
      modelId: resolveModelId(nextAgent, settings.modelId),
    });
  };

  return (
    <SettingsToggleCard
      icon={GitCommitHorizontal}
      title="Git Commit Message Generation"
      description="Enable the button for AI commit message generation"
      enabled={settings.enabled}
      onToggle={handleToggle}
      ariaLabel="Enable Git commit generation"
    >
      {settings.enabled && (
        <div className="flex flex-col gap-3 mt-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-ide-small text-foreground-secondary">
              <span>AI Agent:</span>
            </div>
            <DropdownSelect
              value={activeAgent?.id ?? ''}
              onChange={handleAgentChange}
              options={agentOptions}
              className="min-w-[180px]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-ide-small text-foreground-secondary">
              <span>Model:</span>
            </div>
            <DropdownSelect
              value={activeModelId}
              onChange={(modelId) => update({ modelId })}
              disabled={models.length === 0}
              options={modelOptions}
              className="min-w-[180px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-ide-small text-foreground-secondary">
              <span>Custom Instructions (optional): </span>
            </div>
            <textarea
              value={settings.instructions}
              onChange={(event) => update({ instructions: event.target.value })}
              rows={5}
              placeholder="Describe how commit messages should be written."
              className="w-full max-w-[400px] resize-y rounded-[4px] px-3 py-2 text-ide-small"
            />
          </div>
        </div>
      )}
    </SettingsToggleCard>
  );
}
