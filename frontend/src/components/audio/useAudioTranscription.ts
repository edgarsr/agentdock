import { useSyncExternalStore } from 'react';
import { AudioTranscriptionFeatureState, AudioTranscriptionSettings } from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import { AUDIO_TRANSCRIPTION_NONE, normalizeAudioTranscriptionProvider } from './audioTranscription';

export const emptyAudioTranscriptionFeature: AudioTranscriptionFeatureState = {
  id: AUDIO_TRANSCRIPTION_NONE,
  title: 'None',
  installed: false,
  installing: false,
  supported: false,
  installable: false,
  installPath: '',
};

const emptySnapshot = { provider: AUDIO_TRANSCRIPTION_NONE, feature: emptyAudioTranscriptionFeature };
let snapshot = emptySnapshot;
const listeners = new Set<() => void>();
let disconnect: (() => void) | undefined;

function publish(provider: string, feature: AudioTranscriptionFeatureState) {
  snapshot = { provider, feature };
  listeners.forEach(listener => listener());
}

function connect() {
  let settingsKey: string | undefined;
  let cleanupFeature: (() => void) | undefined;
  const updateSettings = (settings: AudioTranscriptionSettings | undefined) => {
    const key = JSON.stringify(settings);
    if (key === settingsKey) return;
    settingsKey = key;
    const provider = normalizeAudioTranscriptionProvider(settings?.provider);
    if (provider !== snapshot.provider) {
      cleanupFeature?.();
      cleanupFeature = undefined;
      publish(provider, emptyAudioTranscriptionFeature);
    }
    if (provider === AUDIO_TRANSCRIPTION_NONE || !settings) return;
    cleanupFeature ??= ACPBridge.onAudioTranscriptionFeature(e => {
      if (e.detail.state.id === snapshot.provider) publish(snapshot.provider, e.detail.state);
    });
    ACPBridge.loadAudioTranscriptionFeature({ ...settings, provider });
  };
  const cleanupSettings = ACPBridge.onGlobalSettings(e => updateSettings(e.detail.payload?.settings?.audioTranscription));
  updateSettings(ACPBridge.getGlobalSettingsSnapshot()?.settings?.audioTranscription);
  return () => {
    cleanupSettings();
    cleanupFeature?.();
    snapshot = emptySnapshot;
  };
}

// Share bridge subscriptions only while audio controls or settings are mounted.
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) disconnect = connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      disconnect?.();
      disconnect = undefined;
    }
  };
}

export function useAudioTranscription() {
  return useSyncExternalStore(subscribe, () => snapshot);
}
