import { useState } from 'react';
import { AudioTranscriptionSettings } from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import { Button } from '../ui/Button';
import { DropdownSelect } from '../ui/DropdownSelect';
import { SettingsCheckbox } from '../settings/SettingsLayout';
import ConfirmationModal from '../ConfirmationModal';
import {
  AUDIO_TRANSCRIPTION_NONE,
  MAX_RECORDING_LIMIT_SECONDS,
  normalizeAudioTranscriptionProvider,
  normalizeRecordingLimitSeconds,
  transcriptionLanguageOptions,
  transcriptionProviders,
  transcriptionProviderOptions,
} from './audioTranscription';
import {
  emptyAudioTranscriptionFeature,
  useAudioTranscription,
} from './useAudioTranscription';

interface AudioTranscriptionSettingsViewProps {
  settings: AudioTranscriptionSettings;
  onSettingsChange: (settings: AudioTranscriptionSettings) => void;
  onSettingsSave: (settings: AudioTranscriptionSettings) => void;
}

function SettingsLoadingSpinner() {
  return <div className='h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent' />;
}

export function AudioTranscriptionSettingsView({
  settings,
  onSettingsChange,
  onSettingsSave,
}: AudioTranscriptionSettingsViewProps) {
  const { feature } = useAudioTranscription();
  const [pendingUninstall, setPendingUninstall] = useState(false);

  const activeProvider = transcriptionProviders.find(({ value }) => value === settings.provider);
  const apiKeyLabel = activeProvider?.apiKeyLabel;
  const providerSettings = settings.providers[settings.provider] || { apiKey: '' };
  const activeFeature = feature.id === settings.provider
    ? feature
    : { ...emptyAudioTranscriptionFeature, id: settings.provider };
  const actionLabel = activeFeature.installed ? 'Uninstall' : 'Install';
  const enabled = settings.provider !== AUDIO_TRANSCRIPTION_NONE;

  const handleProviderChange = (provider: string) => {
    const next = {
      ...settings,
      provider: normalizeAudioTranscriptionProvider(provider),
    };
    onSettingsChange(next);
    onSettingsSave(next);
  };

  // The engine is kept while its installation runs, as in the engine dropdown.
  const handleToggle = () => {
    if (activeFeature.installing) return;
    handleProviderChange(enabled ? AUDIO_TRANSCRIPTION_NONE : transcriptionProviderOptions[0].value);
  };

  const handleLanguageChange =(language: string) => {
    const next = { ...settings, language };
    onSettingsChange(next);
    onSettingsSave(next);
  };

  const handleApiKeyChange = (apiKey: string) => {
    onSettingsChange({
      ...settings,
      providers: {
        ...settings.providers,
        [settings.provider]: {
          ...providerSettings,
          apiKey,
        },
      },
    });
  };

  const handleApiKeyBlur = () => {
    const next = {
      ...settings,
      providers: {
        ...settings.providers,
        [settings.provider]: {
          ...providerSettings,
          apiKey: providerSettings.apiKey.trim(),
        },
      },
    };
    onSettingsChange(next);
    onSettingsSave(next);
  };

  const handleAudioInputAction = () => {
    if (!activeFeature.installable || !activeFeature.supported || activeFeature.installing) return;
    if (activeFeature.installed) {
      setPendingUninstall(true);
      return;
    }
    ACPBridge.installAudioTranscriptionFeature(settings);
  };

  const confirmAudioInputUninstall = () => {
    ACPBridge.uninstallAudioTranscriptionFeature(settings);
    setPendingUninstall(false);
  };

  return (
    <>
      <SettingsCheckbox
        title='Voice Input'
        description='Dictate chat prompts using speech transcription'
        checked={enabled}
        onToggle={handleToggle}
        ariaLabel='Enable voice input'
      >
        {enabled && (
          <>
            <div className='grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-2 gap-y-4'>
              <span className='text-foreground'>Transcription engine:</span>
              <DropdownSelect
                value={settings.provider}
                onChange={handleProviderChange}
                options={transcriptionProviderOptions}
                disabled={activeFeature.installing || pendingUninstall}
                className='max-w-full justify-self-start'
              />

              {apiKeyLabel && (
                <>
                  <span className='text-foreground'>{apiKeyLabel}:</span>
                  <input
                    type='password'
                    value={providerSettings.apiKey}
                    onChange={(event) => handleApiKeyChange(event.target.value)}
                    onBlur={handleApiKeyBlur}
                    placeholder={activeProvider?.apiKeyPlaceholder}
                    autoComplete='off'
                    aria-label={apiKeyLabel}
                    className='w-60 max-w-full rounded-[3px]'
                  />
                  {activeProvider?.apiKeyUrl && (
                    <div className='col-span-2 -mt-3 text-ide-small text-foreground-secondary'>
                      <button
                        type='button'
                        onClick={() => window.__openUrl?.(activeProvider.apiKeyUrl!)}
                        className='text-link hover:underline'
                      >
                        Create an API key
                      </button>
                      {activeProvider.pricingDescription && ` · ${activeProvider.pricingDescription}`}
                    </div>
                  )}
                </>
              )}

              <span className='text-foreground'>Language:</span>
              <DropdownSelect
                value={settings.language}
                onChange={handleLanguageChange}
                options={transcriptionLanguageOptions}
                disabled={!activeFeature.installed}
                className='max-w-full justify-self-start'
              />
              {activeFeature.installable && activeFeature.installed && activeFeature.installPath && (
                <div className='col-span-2 -mt-3 break-all text-ide-small text-foreground-secondary'>
                  Installed at <span className='font-mono'>{activeFeature.installPath}</span>
                </div>
              )}

              <span className='text-foreground'>Recording limit (s):</span>
              <input
                type='text'
                inputMode='numeric'
                pattern='[1-9][0-9]*'
                value={settings.recordingLimitSeconds ?? ''}
                onChange={(event) => {
                  const input = event.currentTarget;
                  if (!input.validity.valid || Number(input.value) > MAX_RECORDING_LIMIT_SECONDS) return;
                  onSettingsChange({
                    ...settings,
                    recordingLimitSeconds: input.value === '' ? null : Number(input.value),
                  });
                }}
                onBlur={() => onSettingsSave({
                  ...settings,
                  recordingLimitSeconds: normalizeRecordingLimitSeconds(settings.recordingLimitSeconds),
                })}
                aria-label='Recording limit in seconds'
                className='w-16 max-w-full rounded-[3px]'
              />
              <div className='col-span-2 -mt-3 text-ide-small text-foreground-secondary'>
                Maximum: 600 s (10 minutes).
              </div>
            </div>

            {activeFeature.installable && activeFeature.supported && (
              <div className='flex gap-2'>
                <Button
                  onClick={handleAudioInputAction}
                  disabled={activeFeature.installing}
                  variant={activeFeature.installed ? 'accentOutline' : 'install'}
                  leftIcon={activeFeature.installing ? <SettingsLoadingSpinner /> : undefined}
                >
                  {actionLabel}
                </Button>
                {/* Uninstalling also reports `installing`, but only an installation can be cancelled. */}
                {activeFeature.installing && !activeFeature.installed && (
                  <Button
                    onClick={() => ACPBridge.cancelAudioTranscriptionFeatureInstall(settings)}
                    variant='accentOutline'
                  >
                    Cancel
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </SettingsCheckbox>

      <ConfirmationModal
        isOpen={pendingUninstall}
        title={`Uninstall ${activeFeature.title}`}
        message={`Do you want to uninstall ${activeFeature.title}?`}
        onConfirm={confirmAudioInputUninstall}
        onCancel={() => setPendingUninstall(false)}
      />
    </>
  );
}
