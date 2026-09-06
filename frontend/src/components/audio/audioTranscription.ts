import type { DropdownOption } from '../ui/DropdownSelect';

export const AUDIO_TRANSCRIPTION_NONE = 'none';
export const GPT_TRANSCRIBER = 'gpt-transcriber';
export const GEMINI_TRANSCRIBER = 'gemini-transcriber';
export const WHISPER = 'whisper-transcription';

export interface TranscriptionProviderDefinition {
  value: string;
  label: string;
  chatLabel?: string;
  apiKeyLabel?: string;
  apiKeyPlaceholder?: string;
  apiKeyUrl?: string;
  pricingDescription?: string;
}

const isWindowsClient = typeof navigator !== 'undefined'
  && /windows|win32|win64/i.test(`${navigator.platform} ${navigator.userAgent}`);

export const transcriptionProviders: TranscriptionProviderDefinition[] = [
  { value: AUDIO_TRANSCRIPTION_NONE, label: 'None' },
  {
    value: GPT_TRANSCRIBER,
    label: 'GPT Transcriber',
    chatLabel: 'Transcribe voice input in chat with OpenAI GPT Transcriber',
    apiKeyLabel: 'OpenAI API key',
    apiKeyPlaceholder: 'sk-...',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    pricingDescription: 'GPT Transcribe costs $0.0045 per audio minute.',
  },
  {
    value: GEMINI_TRANSCRIBER,
    label: 'Gemini 3.5 Transcribe',
    chatLabel: 'Transcribe voice input in chat with Google Gemini 3.5 Transcribe',
    apiKeyLabel: 'Google Gemini API key',
    apiKeyPlaceholder: 'AIza...',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    pricingDescription: 'Free tier available with limited quotas. Paid: ~$0.005/audio minute',
  },
  ...(isWindowsClient
    ? [{ value: WHISPER, label: 'Whisper', chatLabel: 'Transcribe voice input in chat with Whisper' }]
    : []),
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
