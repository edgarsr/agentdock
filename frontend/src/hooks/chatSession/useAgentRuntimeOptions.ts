import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AgentOption,
  ConfigOption,
  SessionConfigOptionsPayload,
} from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';

type UseAgentRuntimeOptionsArgs = {
  availableAgents: AgentOption[];
  effectiveSelectedAgent: AgentOption | undefined;
  selectedAgentId: string;
};

const matches = (option: ConfigOption, category: string) =>
  option.id === category || option.category === category;

const isReasoning = (option: ConfigOption) =>
  matches(option, 'thought_level') || matches(option, 'reasoning_effort');

const accepts = (option: ConfigOption, value?: string) =>
  !!value && (option.type === 'boolean'
    ? value === 'true' || value === 'false'
    : option.options.some((item) => item.value === value));

const EMPTY_SELECTION: Record<string, string> = {};

export function useAgentRuntimeOptions({
  availableAgents,
  effectiveSelectedAgent,
  selectedAgentId,
}: UseAgentRuntimeOptionsArgs) {
  const [sessionConfigOptions, setSessionConfigOptions] = useState<SessionConfigOptionsPayload>();
  const [selectedByAgent, setSelectedByAgent] = useState<Record<string, Record<string, string>>>({});
  const initialValuesByAgent = useRef<Record<string, Record<string, string>>>({});
  const sessionAgentId = effectiveSelectedAgent?.id;
  const adapterOptions = effectiveSelectedAgent?.configOptions ?? [];
  if (sessionAgentId && adapterOptions.length > 0 && initialValuesByAgent.current[sessionAgentId] === undefined) {
    initialValuesByAgent.current[sessionAgentId] = Object.fromEntries(adapterOptions.map((option) => [
      option.id,
      accepts(option, option.currentValue)
        ? option.currentValue ?? ''
        : option.options[0]?.value ?? '',
    ]));
  }
  const initialValues = sessionAgentId
    ? initialValuesByAgent.current[sessionAgentId] ?? EMPTY_SELECTION
    : EMPTY_SELECTION;
  const options = sessionConfigOptions?.configOptions ?? effectiveSelectedAgent?.configOptions ?? [];
  const selected = effectiveSelectedAgent
    ? selectedByAgent[effectiveSelectedAgent.id] ?? EMPTY_SELECTION
    : EMPTY_SELECTION;
  const modelOption = options.find((option) => matches(option, 'model'));
  const modelValue = selected[modelOption?.id ?? ''];
  const initialModelValue = initialValues[modelOption?.id ?? ''];
  const selectedModelId = modelOption
    ? (accepts(modelOption, modelValue)
      ? modelValue!
      : accepts(modelOption, initialModelValue)
        ? initialModelValue
        : modelOption.options[0]?.value || '')
    : '';

  const effectiveOptions = useMemo(() => selectedModelId
    ? sessionConfigOptions?.configOptionsByModel[selectedModelId]
      ?? effectiveSelectedAgent?.configOptionsByModel?.[selectedModelId]
      ?? options
    : options, [
    effectiveSelectedAgent?.configOptionsByModel,
    options,
    selectedModelId,
    sessionConfigOptions?.configOptionsByModel,
  ]);
  const configValues = useMemo(() => Object.fromEntries(effectiveOptions
    .filter((option) => option.type !== 'select' || option.options.length > 0)
    .map((option) => {
      const selectedValue = selected[option.id];
      const initialValue = initialValues[option.id];
      const value = accepts(option, selectedValue)
        ? selectedValue!
        : accepts(option, initialValue)
          ? initialValue!
          : option.options[0]?.value ?? option.currentValue ?? '';
      return [option.id, value];
    })
    .filter(([, value]) => value !== '')),
    [effectiveOptions, initialValues, selected]
  );
  const selectedConfigOptions = effectiveOptions
    .filter((option) => configValues[option.id] !== undefined)
    .map((option) => {
      const value = configValues[option.id];
      return {
        id: option.id,
        name: option.name,
        value,
        displayValue: option.options.find((candidate) => candidate.value === value)?.name ?? value,
      };
    });

  const modeOption = effectiveOptions.find((option) => matches(option, 'mode'));
  const reasoningOption = effectiveOptions.find(isReasoning);
  const selectedModeId = modeOption ? configValues[modeOption.id] ?? '' : '';
  const selectedReasoningEffortId = reasoningOption ? configValues[reasoningOption.id] ?? '' : '';
  const availableModes = modeOption?.options.map((option) => ({
    id: option.value,
    name: option.name,
    description: option.description,
  })) ?? [];
  const availableReasoningEfforts = reasoningOption?.options.map((option) => ({
    id: option.value,
    name: option.name,
    description: option.description,
  })) ?? [];
  const additionalConfigOptions = effectiveOptions
    .filter((option) => !matches(option, 'model') && !matches(option, 'mode') && !isReasoning(option))
    .map((option) => ({ ...option, currentValue: configValues[option.id] ?? option.currentValue ?? '' }));

  const handleSessionConfigOptions = useCallback((payload: SessionConfigOptionsPayload) => {
    if (!sessionAgentId) return;
    setSessionConfigOptions(payload);
    const reportedValues: Record<string, string> = {};
    payload.configOptions.forEach((option) => {
      if (option.currentValue) reportedValues[option.id] = option.currentValue;
    });
    setSelectedByAgent((current) => ({
      ...current,
      [sessionAgentId]: { ...current[sessionAgentId], ...reportedValues },
    }));
  }, [sessionAgentId]);

  useEffect(() => setSessionConfigOptions(undefined), [selectedAgentId]);

  const updateConfigValue = (
    configId: string,
    value: string,
    targetAgentId = selectedAgentId,
    remember = false,
  ) => {
    if (!targetAgentId) return;
    if (remember) ACPBridge.rememberAgentConfigOption(targetAgentId, configId, value);
    setSelectedByAgent((current) => ({
      ...current,
      [targetAgentId]: {
        ...current[targetAgentId],
        [configId]: value,
      },
    }));
  };

  const selectConfigValue = (configId: string, value: string, targetAgentId = selectedAgentId) =>
    updateConfigValue(configId, value, targetAgentId, true);

  const handleModelChange = (modelId: string, targetAgentId?: string) => {
    const agentId = targetAgentId || selectedAgentId;
    const agent = availableAgents.find((item) => item.id === agentId)
      ?? (effectiveSelectedAgent?.id === agentId ? effectiveSelectedAgent : undefined);
    const option = agentId === sessionAgentId
      ? modelOption
      : agent?.configOptions?.find((item) => matches(item, 'model'));
    if (option) selectConfigValue(option.id, modelId, agentId);
  };

  return {
    availableModels: modelOption?.options.map((option) => ({
      modelId: option.value,
      name: option.name,
      description: option.description,
    })) ?? [],
    availableModes,
    availableReasoningEfforts,
    additionalConfigOptions,
    configValues,
    selectedConfigOptions,
    selectedModelId,
    selectedModeId,
    selectedReasoningEffortId,
    modelIdForStart: selectedAgentId ? selectedModelId : '',
    handleSessionConfigOptions,
    handleModelChange,
    handleReportedModeChange: (value: string) =>
      modeOption && updateConfigValue(modeOption.id, value),
    handleModeChange: (value: string) => modeOption && selectConfigValue(modeOption.id, value),
    handleReasoningEffortChange: (value: string) =>
      reasoningOption && selectConfigValue(reasoningOption.id, value),
    handleConfigOptionChange: selectConfigValue,
  };
}
