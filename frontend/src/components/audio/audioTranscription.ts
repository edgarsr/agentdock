import type { DropdownOption } from '../ui/DropdownSelect';

export const AUDIO_TRANSCRIPTION_NONE = 'none';
export const GPT_TRANSCRIBER = 'gpt-transcriber';
export const WHISPER = 'whisper-transcription';

export interface TranscriptionProviderDefinition {
  value: string;
  label: string;
  chatLabel?: string;
  apiKeyLabel?: string;
  apiKeyPlaceholder?: string;
}

export const transcriptionProviders: TranscriptionProviderDefinition[] = [
  { value: AUDIO_TRANSCRIPTION_NONE, label: 'None' },
  {
    value: GPT_TRANSCRIBER,
    label: 'GPT Transcriber',
    chatLabel: 'Transcribe voice input in chat with OpenAI GPT Transcriber',
    apiKeyLabel: 'OpenAI API key',
    apiKeyPlaceholder: 'sk-...',
  },
  { value: WHISPER, label: 'Whisper', chatLabel: 'Transcribe voice input in chat with Whisper' },
];

const transcriptionProviderIds = new Set(transcriptionProviders.map(({ value }) => value));

export function normalizeAudioTranscriptionProvider(provider: string | undefined): string {
  const normalized = provider?.trim().toLowerCase();
  return normalized && transcriptionProviderIds.has(normalized)
    ? normalized
    : AUDIO_TRANSCRIPTION_NONE;
}

export const transcriptionProviderOptions: DropdownOption[] = transcriptionProviders.map(({ value, label }) => ({
  value,
  label,
}));

export const transcriptionLanguageOptions: DropdownOption[] = [
  { value: 'auto', label: 'auto' },
  { value: 'en', label: 'English (en)' },
  { value: 'de', label: 'German (de)' },
  { value: 'lv', label: 'Latvian (lv)' },
  { value: 'fr', label: 'French (fr)' },
  { value: 'es', label: 'Spanish (es)' },
];
