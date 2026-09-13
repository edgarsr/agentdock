import { ConfigOption } from '../types/chat';

const REASONING_EFFORT_IDS = ['effort', 'reasoning_effort'];

export function findReasoningEffortOption(options: ConfigOption[]): ConfigOption | undefined {
  return options.find((option) => REASONING_EFFORT_IDS.includes(option.id))
    ?? options.find((option) => option.id === 'thought_level')
    ?? options.find((option) => option.category === 'thought_level');
}
