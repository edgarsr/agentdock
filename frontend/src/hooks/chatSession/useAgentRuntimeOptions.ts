import { useEffect, useMemo, useState } from 'react';
import { AgentOption, HistorySessionMeta } from '../../types/chat';

type UseAgentRuntimeOptionsArgs = {
  availableAgents: AgentOption[];
  effectiveSelectedAgent: AgentOption | undefined;
  selectedAgentId: string;
  historySession?: HistorySessionMeta;
};

export function useAgentRuntimeOptions({
  availableAgents,
  effectiveSelectedAgent,
  selectedAgentId,
  historySession,
}: UseAgentRuntimeOptionsArgs) {
  const [selectedModelByAgent, setSelectedModelByAgent] = useState<Record<string, string>>({});
  const [selectedModeByAgent, setSelectedModeByAgent] = useState<Record<string, string>>({});
  const [selectedReasoningEffortByAgent, setSelectedReasoningEffortByAgent] = useState<Record<string, string>>({});
  const availableModels = effectiveSelectedAgent?.availableModels ?? [];

  const selectedModelId = effectiveSelectedAgent
    ? (selectedModelByAgent[effectiveSelectedAgent.id] || effectiveSelectedAgent.currentModelId || availableModels[0]?.modelId || '')
    : '';

  const hasModesByModel = !!effectiveSelectedAgent?.availableModesByModel &&
    Object.keys(effectiveSelectedAgent.availableModesByModel).length > 0;
  const availableModes = hasModesByModel
    ? (selectedModelId ? effectiveSelectedAgent?.availableModesByModel?.[selectedModelId] ?? [] : [])
    : effectiveSelectedAgent?.availableModes ?? [];
  const availableModeIds = useMemo(() => new Set(availableModes.map((mode) => mode.id)), [availableModes]);

  const hasReasoningEffortsByModel = !!effectiveSelectedAgent?.reasoningEffortsByModel &&
    Object.keys(effectiveSelectedAgent.reasoningEffortsByModel).length > 0;
  const availableReasoningEfforts = hasReasoningEffortsByModel
    ? (selectedModelId ? effectiveSelectedAgent?.reasoningEffortsByModel?.[selectedModelId] ?? [] : [])
    : effectiveSelectedAgent?.availableReasoningEfforts ?? [];
  const availableReasoningEffortIds = useMemo(
    () => new Set(availableReasoningEfforts.map((effort) => effort.id)),
    [availableReasoningEfforts]
  );

  const selectedModeId = effectiveSelectedAgent
    ? (
        selectedModeByAgent[effectiveSelectedAgent.id] &&
        availableModeIds.has(selectedModeByAgent[effectiveSelectedAgent.id])
          ? selectedModeByAgent[effectiveSelectedAgent.id]
          : (
              effectiveSelectedAgent.currentModeId &&
              availableModeIds.has(effectiveSelectedAgent.currentModeId)
                ? effectiveSelectedAgent.currentModeId
                : availableModes[0]?.id || ''
            )
      )
    : '';

  const selectedReasoningEffortId = effectiveSelectedAgent
    ? (
        selectedReasoningEffortByAgent[effectiveSelectedAgent.id] &&
        availableReasoningEffortIds.has(selectedReasoningEffortByAgent[effectiveSelectedAgent.id])
          ? selectedReasoningEffortByAgent[effectiveSelectedAgent.id]
          : (
              effectiveSelectedAgent.currentReasoningEffortId &&
              availableReasoningEffortIds.has(effectiveSelectedAgent.currentReasoningEffortId)
                ? effectiveSelectedAgent.currentReasoningEffortId
                : availableReasoningEfforts[0]?.id || ''
            )
      )
    : '';

  const modelIdForStart = selectedAgentId
    ? selectedModelId
    : '';

  const resolveReasoningEffortsForModel = (agent: AgentOption | undefined, modelId: string) => {
    if (!agent || !modelId) return [];
    if (agent.reasoningEffortsByModel && Object.keys(agent.reasoningEffortsByModel).length > 0) {
      return agent.reasoningEffortsByModel?.[modelId] ?? [];
    }
    return agent.availableReasoningEfforts ?? [];
  };

  const resolveModesForModel = (agent: AgentOption | undefined, modelId: string) => {
    if (!agent || !modelId) return [];
    if (agent.availableModesByModel && Object.keys(agent.availableModesByModel).length > 0) {
      return agent.availableModesByModel?.[modelId] ?? [];
    }
    return agent.availableModes ?? [];
  };

  useEffect(() => {
    if (availableAgents.length === 0) return;
    setSelectedModelByAgent((prev) => {
      const next: Record<string, string> = { ...prev };
      availableAgents.forEach((agent) => {
        if (next[agent.id]) return;
        const currentModel = agent.currentModelId || agent.availableModels?.[0]?.modelId || '';
        if (currentModel) next[agent.id] = currentModel;
      });
      return next;
    });

  }, [availableAgents]);

  useEffect(() => {
    if (!historySession) return;
    if (historySession.modelId) {
      setSelectedModelByAgent((prev) => ({
        ...prev,
        [historySession.adapterName]: historySession.modelId as string
      }));
    }
    if (historySession.modeId) {
      setSelectedModeByAgent((prev) => ({
        ...prev,
        [historySession.adapterName]: historySession.modeId as string
      }));
    }
  }, [historySession]);

  useEffect(() => {
    if (!selectedAgentId) return;
    setSelectedModeByAgent((prev) => {
      const current = prev[selectedAgentId];
      if (current && availableModeIds.has(current)) return prev;
      if (availableModes.length === 0) {
        if (!current) return prev;
        const next = { ...prev };
        delete next[selectedAgentId];
        return next;
      }
      return { ...prev, [selectedAgentId]: selectedModeId || availableModes[0].id };
    });
  }, [availableModeIds, availableModes, selectedAgentId, selectedModeId]);

  useEffect(() => {
    if (!selectedAgentId) return;
    setSelectedReasoningEffortByAgent((prev) => {
      const current = prev[selectedAgentId];
      if (current && availableReasoningEffortIds.has(current)) return prev;
      if (availableReasoningEfforts.length === 0) {
        if (!current) return prev;
        const next = { ...prev };
        delete next[selectedAgentId];
        return next;
      }
      return { ...prev, [selectedAgentId]: selectedReasoningEffortId || availableReasoningEfforts[0].id };
    });
  }, [
    availableReasoningEffortIds,
    availableReasoningEfforts,
    selectedAgentId,
    selectedReasoningEffortId,
  ]);

  const handleModelChange = (modelId: string, targetAgentId?: string) => {
    const agentId = targetAgentId || selectedAgentId;
    setSelectedModelByAgent((prev) => (
      agentId ? { ...prev, [agentId]: modelId } : prev
    ));
    if (!agentId) return;

    const agent = availableAgents.find((item) => item.id === agentId)
      || (effectiveSelectedAgent?.id === agentId ? effectiveSelectedAgent : undefined);
    const modes = resolveModesForModel(agent, modelId);
    const efforts = resolveReasoningEffortsForModel(agent, modelId);
    setSelectedModeByAgent((prev) => {
      if (modes.length === 0) {
        if (!prev[agentId]) return prev;
        const next = { ...prev };
        delete next[agentId];
        return next;
      }

      const current = prev[agentId];
      if (current && modes.some((mode) => mode.id === current)) return prev;
      return { ...prev, [agentId]: modes[0].id };
    });
    setSelectedReasoningEffortByAgent((prev) => {
      if (efforts.length === 0) {
        if (!prev[agentId]) return prev;
        const next = { ...prev };
        delete next[agentId];
        return next;
      }

      const current = prev[agentId];
      if (current && efforts.some((effort) => effort.id === current)) return prev;
      return { ...prev, [agentId]: efforts[0].id };
    });
  };

  const handleModeChange = (modeId: string) => {
    setSelectedModeByAgent((prev) => (
      selectedAgentId ? { ...prev, [selectedAgentId]: modeId } : prev
    ));
  };

  const handleReasoningEffortChange = (reasoningEffortId: string) => {
    setSelectedReasoningEffortByAgent((prev) => (
      selectedAgentId ? { ...prev, [selectedAgentId]: reasoningEffortId } : prev
    ));
  };

  return {
    availableModels,
    availableModes,
    availableReasoningEfforts,
    selectedModelId,
    selectedModeId,
    selectedReasoningEffortId,
    modelIdForStart,
    handleModelChange,
    handleModeChange,
    handleReasoningEffortChange,
  };
}
