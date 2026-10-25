import { AudioOutputSettings } from '../../types/chat';
import { DropdownSelect } from '../ui/DropdownSelect';
import { SettingsCheckbox } from '../settings/SettingsLayout';
import { AUDIO_OUTPUT_NONE, SYSTEM_VOICES, speechProviders, useSystemVoices } from './speechOutput';

interface AudioOutputSettingsViewProps {
  settings: AudioOutputSettings;
  onSettingsChange: (settings: AudioOutputSettings) => void;
  onSettingsSave: (settings: AudioOutputSettings) => void;
}

const voiceLabel = (voice: string) => voice.charAt(0).toUpperCase() + voice.slice(1);

export function AudioOutputSettingsView({ settings, onSettingsChange, onSettingsSave }: AudioOutputSettingsViewProps) {
  const voices = useSystemVoices();
  // System voices are offered only where the client has some.
  const providerOptions = speechProviders
    .filter(({ value }) => value !== AUDIO_OUTPUT_NONE && (value !== SYSTEM_VOICES || voices.length > 0))
    .map(({ value, label }) => ({ value, label }));
  const enabled = settings.provider !== AUDIO_OUTPUT_NONE;
  const activeProvider = speechProviders.find(({ value }) => value === settings.provider);
  const providerSettings = settings.providers[settings.provider] || { apiKey: '', voice: '' };
  const voiceOptions = settings.provider === SYSTEM_VOICES
    ? [{ value: '', label: 'Default' }, ...voices.map(({ voiceURI, name }) => ({ value: voiceURI, label: name }))]
    : (activeProvider?.voices ?? []).map((voice) => ({ value: voice, label: voiceLabel(voice) }));

  const withProviderSettings = (patch: Partial<typeof providerSettings>) => ({
    ...settings,
    providers: { ...settings.providers, [settings.provider]: { ...providerSettings, ...patch } },
  });

  const save = (next: AudioOutputSettings) => {
    onSettingsChange(next);
    onSettingsSave(next);
  };

  return (
    <SettingsCheckbox
      title='Voice Output'
      description='Read assistant messages aloud'
      checked={enabled}
      onToggle={() => save({ ...settings, provider: enabled ? AUDIO_OUTPUT_NONE : providerOptions[0].value })}
      ariaLabel='Enable voice output'
    >
      {enabled && (
        <div className='grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-2 gap-y-4'>
          <span className='text-foreground'>Speech engine:</span>
          <DropdownSelect
            value={settings.provider}
            onChange={(provider) => save({ ...settings, provider })}
            options={providerOptions}
            className='max-w-full justify-self-start'
          />

          {activeProvider?.apiKeyLabel && (
            <>
              <span className='text-foreground'>{activeProvider.apiKeyLabel}:</span>
              <input
                type='password'
                value={providerSettings.apiKey}
                onChange={(event) => onSettingsChange(withProviderSettings({ apiKey: event.target.value }))}
                onBlur={() => save(withProviderSettings({ apiKey: providerSettings.apiKey.trim() }))}
                placeholder={activeProvider.apiKeyPlaceholder}
                autoComplete='off'
                aria-label={activeProvider.apiKeyLabel}
                className='w-60 max-w-full rounded-[3px]'
              />
              {activeProvider.apiKeyUrl && (
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

          {voiceOptions.length > 0 && (
            <>
              <span className='text-foreground'>Voice:</span>
              <DropdownSelect
                value={providerSettings.voice}
                onChange={(voice) => save(withProviderSettings({ voice }))}
                options={voiceOptions}
                className='max-w-full justify-self-start'
              />
            </>
          )}
        </div>
      )}
    </SettingsCheckbox>
  );
}
