import { AgentOption, DropdownOption, ModeOption } from '../../types/chat';

export type PinnedAgentSnapshot = {
  id: string;
  name?: string;
  iconPath?: string;
  currentModelId?: string;
  availableModels?: AgentOption['availableModels'];
  currentModeId?: string;
  availableModes?: AgentOption['availableModes'];
  availableModesByModel?: AgentOption['availableModesByModel'];
  currentReasoningEffortId?: string;
  availableReasoningEfforts?: AgentOption['availableReasoningEfforts'];
  reasoningEffortsByModel?: AgentOption['reasoningEffortsByModel'];
};

export function toPinnedAgentSnapshot(agent: AgentOption): PinnedAgentSnapshot {
  return {
    id: agent.id,
    name: agent.name,
    iconPath: agent.iconPath,
    currentModelId: agent.currentModelId,
    availableModels: agent.availableModels,
    currentModeId: agent.currentModeId,
    availableModes: agent.availableModes,
    availableModesByModel: agent.availableModesByModel,
    currentReasoningEffortId: agent.currentReasoningEffortId,
    availableReasoningEfforts: agent.availableReasoningEfforts,
    reasoningEffortsByModel: agent.reasoningEffortsByModel,
  };
}

export function resolveSelectedAgent(
  selectedAgent: AgentOption | undefined,
  pinnedSnapshot: PinnedAgentSnapshot | null,
  pinnedAgentId: string
): AgentOption | undefined {
  if (selectedAgent) return selectedAgent;
  if (!pinnedSnapshot || pinnedSnapshot.id !== pinnedAgentId) return undefined;
  return {
    id: pinnedSnapshot.id,
    name: pinnedSnapshot.name,
    iconPath: pinnedSnapshot.iconPath,
    currentModelId: pinnedSnapshot.currentModelId,
    availableModels: pinnedSnapshot.availableModels,
    currentModeId: pinnedSnapshot.currentModeId,
    availableModes: pinnedSnapshot.availableModes,
    availableModesByModel: pinnedSnapshot.availableModesByModel,
    currentReasoningEffortId: pinnedSnapshot.currentReasoningEffortId,
    availableReasoningEfforts: pinnedSnapshot.availableReasoningEfforts,
    reasoningEffortsByModel: pinnedSnapshot.reasoningEffortsByModel,
  } as AgentOption;
}

export function buildAgentOptions(
  availableAgents: AgentOption[],
  pinnedSnapshot: PinnedAgentSnapshot | null,
  pinnedAgentId: string
): DropdownOption[] {
  const options = availableAgents.map((agent) => ({
    id: agent.id,
    label: agent.name,
    iconPath: agent.iconPath,
    subOptions: agent.availableModels?.map(m => ({
      id: m.modelId,
      label: m.name,
      description: m.description,
    }))
  }));

  if (
    pinnedSnapshot &&
    pinnedAgentId &&
    pinnedSnapshot.id === pinnedAgentId &&
    !options.some((option) => option.id === pinnedAgentId)
  ) {
    options.unshift({
      id: pinnedSnapshot.id,
      label: pinnedSnapshot.name || pinnedSnapshot.id,
      iconPath: pinnedSnapshot.iconPath,
      subOptions: pinnedSnapshot.availableModels?.map((model) => ({
        id: model.modelId,
        label: model.name,
        description: model.description,
      })) || (pinnedSnapshot.currentModelId ? [{
        id: pinnedSnapshot.currentModelId,
        label: pinnedSnapshot.currentModelId,
        description: undefined,
      }] : []),
    });
  }

  return options;
}

export function buildModeOptions(availableModes: ModeOption[], selectedModeId: string): DropdownOption[] {
  const options = availableModes.map((mode) => ({
    id: mode.id,
    label: mode.name,
    description: mode.description,
  }));

  if (options.length > 0) return options;
  if (!selectedModeId) return [];
  return [{
    id: selectedModeId,
    label: selectedModeId,
    description: undefined,
  }];
}

export function buildReasoningEffortOptions(
  availableReasoningEfforts: AgentOption['availableReasoningEfforts'] = [],
  _selectedReasoningEffortId: string
): DropdownOption[] {
  return availableReasoningEfforts.map((effort) => ({
    id: effort.id,
    label: effort.name,
    description: effort.description,
  }));
}
