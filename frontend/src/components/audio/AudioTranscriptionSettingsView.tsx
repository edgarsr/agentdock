import { useState } from 'react';
import { AudioTranscriptionSettings } from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import { Button } from '../ui/Button';
import { DropdownSelect } from '../ui/DropdownSelect';
import { SettingsField, SettingsSection } from '../settings/SettingsLayout';
import ConfirmationModal from '../ConfirmationModal';
import {
  AUDIO_TRANSCRIPTION_NONE,
  normalizeAudioTranscriptionProvider,
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

  const handleProviderChange = (provider: string) => {
    const next = {
      ...settings,
      provider: normalizeAudioTranscriptionProvider(provider),
    };
    onSettingsChange(next);
    onSettingsSave(next);
  };

  const handleLanguageChange = (language: string) => {
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
      <SettingsSection title='Audio Input'>
        <SettingsField label='Transcription engine' colon>
          <DropdownSelect
            value={settings.provider}
            onChange={handleProviderChange}
            options={transcriptionProviderOptions}
            disabled={activeFeature.installing || pendingUninstall}
            className='max-w-full'
          />
        </SettingsField>

        {settings.provider !== AUDIO_TRANSCRIPTION_NONE && (
          <SettingsField
            label={activeProvider?.chatLabel || `Transcribe voice input in chat with ${activeFeature.title}`}
            stacked
          >
            <div className='flex flex-col gap-3'>
              {apiKeyLabel && (
                <SettingsField
                  label={apiKeyLabel}
                  colon
                  description={activeProvider?.apiKeyUrl ? (
                    <span className='inline-block pt-1'>
                      <button
                        type='button'
                        onClick={() => window.__openUrl?.(activeProvider.apiKeyUrl!)}
                        className='text-link hover:underline'
                      >
                        Create an API key
                      </button>
                      {activeProvider.pricingDescription && ` · ${activeProvider.pricingDescription}`}
                    </span>
                  ) : undefined}
                >
                  <input
                    type='password'
                    value={providerSettings.apiKey}
                    onChange={(event) => handleApiKeyChange(event.target.value)}
                    onBlur={handleApiKeyBlur}
                    placeholder={activeProvider?.apiKeyPlaceholder}
                    autoComplete='off'
                    spellCheck={false}
                    aria-label={apiKeyLabel}
                    className='w-60 max-w-full rounded-[3px] px-2 py-1'
                  />
                </SettingsField>
              )}

              <SettingsField
                label='Language'
                colon
                description={
                  activeFeature.installable && activeFeature.installed && activeFeature.installPath ? (
                    <span className='break-all'>
                      Installed at <span className='font-mono'>{activeFeature.installPath}</span>
                    </span>
                  ) : undefined
                }
              >
                <DropdownSelect
                  value={settings.language}
                  onChange={handleLanguageChange}
                  options={transcriptionLanguageOptions}
                  disabled={!activeFeature.installed}
                  className='max-w-full'
                />
              </SettingsField>

              {activeFeature.installable && activeFeature.supported && (
                <div className='mt-1'>
                  <Button
                    onClick={handleAudioInputAction}
                    disabled={activeFeature.installing}
                    variant={activeFeature.installed ? 'accentOutline' : 'install'}
                    leftIcon={activeFeature.installing ? <SettingsLoadingSpinner /> : undefined}
                  >
                    {actionLabel}
                  </Button>
                </div>
              )}
            </div>
          </SettingsField>
        )}
      </SettingsSection>

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
