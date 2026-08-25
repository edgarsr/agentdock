import { useEffect, useState } from 'react';
import {
  AgentOption,
  AudioTranscriptionFeatureState,
  AudioTranscriptionSettings,
  GitCommitGenerationSettings as GitCommitGenerationSettingsValue,
  GlobalSettingsPayload
} from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import ConfirmationModal from './ConfirmationModal';
import { GitCommitGenerationSettings } from './settings/GitCommitGenerationSettings';
import { SettingsCheckbox, SettingsField, SettingsSection } from './settings/SettingsLayout';
import { Button } from './ui/Button';
import { DropdownOption, DropdownSelect } from './ui/DropdownSelect';

const defaultGlobalSettings: GlobalSettingsPayload = {
  settings: {
    audioNotificationsEnabled: true,
    uiFontSizeOffsetPx: 0,
    userMessageBackgroundStyle: 'default',
    audioTranscription: { language: 'auto' },
    gitCommitGeneration: { enabled: false, adapterId: '', modelId: '', reasoningEffortId: '', instructions: '' },
    quotaWidgetEnabled: false
  }
};

function SettingsLoadingSpinner() {
  return <div className='h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent' />;
}

function normalizeGitCommitGenerationSettings(
  payload: Partial<GitCommitGenerationSettingsValue> | undefined
): GitCommitGenerationSettingsValue {
  return {
    enabled: Boolean(payload?.enabled),
    adapterId: payload?.adapterId?.trim() ?? '',
    modelId: payload?.modelId?.trim() ?? '',
    reasoningEffortId: payload?.reasoningEffortId?.trim() ?? '',
    instructions: payload?.instructions ?? ''
  };
}

function normalizeGlobalSettings(payload: Partial<GlobalSettingsPayload> | undefined): GlobalSettingsPayload {
  const uiFontSizeOffsetPx = Number.isFinite(payload?.settings?.uiFontSizeOffsetPx)
    ? Math.max(-3, Math.min(3, Math.round(payload!.settings!.uiFontSizeOffsetPx)))
    : 0;
  return {
    settings: {
      audioNotificationsEnabled: payload?.settings?.audioNotificationsEnabled ?? true,
      uiFontSizeOffsetPx,
      userMessageBackgroundStyle: userMessageBackgroundOptions.some(
        (option) => option.id === payload?.settings?.userMessageBackgroundStyle
      )
        ? payload!.settings!.userMessageBackgroundStyle
        : 'default',
      audioTranscription: payload?.settings?.audioTranscription ?? { language: 'auto' },
      gitCommitGeneration: normalizeGitCommitGenerationSettings(payload?.settings?.gitCommitGeneration),
      quotaWidgetEnabled: payload?.settings?.quotaWidgetEnabled ?? false
    }
  };
}

function readIdeFontSizePx(): number {
  if (typeof window === 'undefined') {
    return 14;
  }
  const value = window.getComputedStyle(document.documentElement).getPropertyValue('--ide-font-size').trim();
  const px = Number.parseFloat(value);
  return Number.isFinite(px) ? Math.round(px) : 14;
}

const userMessageBackgroundOptions: Array<{
  id: GlobalSettingsPayload['settings']['userMessageBackgroundStyle'];
  background: string;
  toneClass: string;
}> = [
  {
    id: 'default',
    background: 'var(--ide-user-message-default-bg)',
    toneClass: 'bg-user-message-default'
  },
  {
    id: 'blue',
    background: 'var(--ide-user-message-blue-bg)',
    toneClass: 'bg-user-message-blue'
  },
  {
    id: 'background-secondary',
    background: 'var(--ide-background-secondary)',
    toneClass: 'bg-background-secondary'
  },
  { id: 'primary', background: 'var(--ide-Button-default-startBackground)', toneClass: 'bg-primary' },
  { id: 'secondary', background: 'var(--ide-Button-startBackground)', toneClass: 'bg-secondary' },
  { id: 'accent', background: 'var(--ide-List-selectionBackground)', toneClass: 'bg-accent' },
  { id: 'input', background: 'var(--ide-TextField-background)', toneClass: 'bg-input' },
  {
    id: 'editor-bg',
    background: 'var(--ide-editor-bg)',
    toneClass: 'bg-editor-bg'
  }
];

const emptyState: AudioTranscriptionFeatureState = {
  id: 'whisper-transcription',
  installed: false,
  installing: false,
  supported: false,
  status: 'Loading',
  installPath: ''
};

const whisperLanguageOptions: DropdownOption[] = [
  { value: 'auto', label: 'auto' },
  { value: 'en', label: 'English (en)' },
  { value: 'de', label: 'German (de)' },
  { value: 'lv', label: 'Latvian (lv)' },
  { value: 'fr', label: 'French (fr)' },
  { value: 'es', label: 'Spanish (es)' }
];

function applyUserMessageTheme(styleId: GlobalSettingsPayload['settings']['userMessageBackgroundStyle']) {
  const selected =
    userMessageBackgroundOptions.find((option) => option.id === styleId) ?? userMessageBackgroundOptions[0];
  document.documentElement.style.setProperty('--user-message-bg', selected.background);
}

export function SettingsView() {
  const [feature, setFeature] = useState<AudioTranscriptionFeatureState>(emptyState);
  const [settings, setSettings] = useState<AudioTranscriptionSettings>({ language: 'auto' });
  const [globalSettings, setGlobalSettings] = useState<GlobalSettingsPayload>(defaultGlobalSettings);
  const [installedAgents, setInstalledAgents] = useState<AgentOption[]>([]);
  const [pendingAudioInputUninstall, setPendingAudioInputUninstall] = useState(false);
  const [uiFontSizeBasePx, setUiFontSizeBasePx] = useState(() => readIdeFontSizePx());
  const uiFontSizeSelectOptions: DropdownOption[] = Array.from({ length: 7 }, (_, index) => {
    const offset = index - 3;
    const px = uiFontSizeBasePx + offset;
    return { value: String(offset), label: offset === 0 ? `${px}px (default)` : `${px}px` };
  });

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--ui-font-size-offset',
      `${globalSettings.settings.uiFontSizeOffsetPx}px`
    );
  }, [globalSettings.settings.uiFontSizeOffsetPx]);

  useEffect(() => {
    setUiFontSizeBasePx(readIdeFontSizePx());
  }, [globalSettings]);

  useEffect(() => {
    applyUserMessageTheme(globalSettings.settings.userMessageBackgroundStyle);
  }, [globalSettings.settings.userMessageBackgroundStyle]);

  useEffect(() => {
    const requestSettings = () => {
      ACPBridge.loadAudioTranscriptionFeature();
      ACPBridge.loadAudioTranscriptionSettings();
      ACPBridge.loadGlobalSettings();
      ACPBridge.requestAdapters();
    };

    const cleanupFeature = ACPBridge.onAudioTranscriptionFeature((e) => {
      setFeature(e.detail.state);
    });
    const cleanupSettings = ACPBridge.onAudioTranscriptionSettings((e) => {
      setSettings(e.detail.settings);
    });
    const cleanupGlobalSettings = ACPBridge.onGlobalSettings((e) => {
      setGlobalSettings(normalizeGlobalSettings(e.detail?.payload));
    });
    const cleanupAdapters = ACPBridge.onAdapters((e) => {
      const nextInstalledAgents = Array.isArray(e.detail.adapters)
        ? e.detail.adapters.filter((agent) => agent.downloaded === true)
        : [];
      setInstalledAgents(nextInstalledAgents);
    });

    const handleBridgeReady = () => {
      requestSettings();
    };

    if (window.__settingsBridgeReady) {
      requestSettings();
    } else {
      window.addEventListener('settings-bridge-ready', handleBridgeReady);
    }

    return () => {
      cleanupFeature();
      cleanupSettings();
      cleanupGlobalSettings();
      cleanupAdapters();
      window.removeEventListener('settings-bridge-ready', handleBridgeReady);
    };
  }, []);

  const actionLabel = feature.installed ? 'Uninstall' : 'Install';
  const showAudioInputDetails = feature.installed || feature.installing;

  const handleAudioInputAction = () => {
    if (feature.installed) {
      setPendingAudioInputUninstall(true);
      return;
    }
    ACPBridge.installAudioTranscriptionFeature();
  };

  const confirmAudioInputUninstall = () => {
    ACPBridge.uninstallAudioTranscriptionFeature();
    setPendingAudioInputUninstall(false);
  };

  const handleLanguageChange = (language: string) => {
    const next = { language };
    setSettings(next);
    ACPBridge.saveAudioTranscriptionSettings(next);
  };

  const updateGlobalSettings = (patch: Partial<GlobalSettingsPayload['settings']>) => {
    const next = { ...globalSettings.settings, ...patch };
    setGlobalSettings((prev) => ({ ...prev, settings: next }));
    ACPBridge.saveGlobalSettings(next);
  };

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <div className='w-full flex-1 overflow-y-auto'>
        <div className='mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 pb-8 pt-6'>
          <SettingsSection title='Appearance'>
            <SettingsField label='Base Font Size' colon>
              <DropdownSelect
                value={String(globalSettings.settings.uiFontSizeOffsetPx)}
                onChange={(value) => updateGlobalSettings({ uiFontSizeOffsetPx: Number(value) })}
                options={uiFontSizeSelectOptions}
                className='max-w-full'
              />
            </SettingsField>

            <SettingsField
              label='User Message Background'
              description='Choose the background color used for your chat messages'
              stacked
            >
              <div className='flex flex-wrap gap-2'>
                {userMessageBackgroundOptions.map((option) => (
                  <button
                    key={option.id}
                    type='button'
                    onClick={() => updateGlobalSettings({ userMessageBackgroundStyle: option.id })}
                    aria-pressed={globalSettings.settings.userMessageBackgroundStyle === option.id}
                    aria-label={`${option.id} message background`}
                    className={`h-8 w-8 rounded-[4px] border ${option.toneClass} focus:outline-none ${
                      globalSettings.settings.userMessageBackgroundStyle === option.id
                        ? 'border-[var(--ide-Button-focusedBorderColor)] shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]'
                        : 'border-border'
                    }`}
                  />
                ))}
              </div>
            </SettingsField>
          </SettingsSection>

          <SettingsSection title='General'>
            <SettingsCheckbox
              title='Audio Notifications'
              description='Play sounds for new assistant messages and permission requests'
              checked={globalSettings.settings.audioNotificationsEnabled}
              onToggle={() =>
                updateGlobalSettings({ audioNotificationsEnabled: !globalSettings.settings.audioNotificationsEnabled })
              }
              ariaLabel='Enable audio notifications'
            />

            <SettingsCheckbox
              title='Status Bar Quota Widget'
              description='Display real-time agent usage quotas in the IDE status bar'
              checked={globalSettings.settings.quotaWidgetEnabled}
              onToggle={() => updateGlobalSettings({ quotaWidgetEnabled: !globalSettings.settings.quotaWidgetEnabled })}
              ariaLabel='Enable status bar quota widget'
            />

            <GitCommitGenerationSettings
              settings={globalSettings.settings.gitCommitGeneration}
              installedAgents={installedAgents}
              onChange={(gitCommitGeneration) => updateGlobalSettings({ gitCommitGeneration })}
            />
          </SettingsSection>

          {feature.supported && (
            <SettingsSection title='Audio Input'>
              <SettingsField label='Transcribe microphone input locally using Whisper' stacked>
                <div className='flex flex-col gap-2'>
                  {showAudioInputDetails && (
                    <>
                      <SettingsField label='Status'>
                        <span className='text-foreground-secondary'>{feature.status}</span>
                      </SettingsField>
                      <SettingsField
                        label='Language'
                        colon
                        description={
                          feature.installed && feature.installPath ? (
                            <span className='break-all'>
                              Installed at <span className='font-mono'>{feature.installPath}</span>
                            </span>
                          ) : undefined
                        }
                      >
                        <DropdownSelect
                          value={settings.language}
                          onChange={handleLanguageChange}
                          options={whisperLanguageOptions}
                          disabled={!feature.installed}
                          className='max-w-full'
                        />
                      </SettingsField>
                    </>
                  )}
                  <div className='mt-1'>
                    <Button
                      onClick={handleAudioInputAction}
                      disabled={feature.installing}
                      variant={feature.installed ? 'accentOutline' : 'install'}
                      leftIcon={feature.installing ? <SettingsLoadingSpinner /> : undefined}
                    >
                      {actionLabel}
                    </Button>
                  </div>
                </div>
              </SettingsField>
            </SettingsSection>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={pendingAudioInputUninstall}
        title='Uninstall Audio Input'
        message='Do you want to uninstall Audio Input?'
        onConfirm={confirmAudioInputUninstall}
        onCancel={() => setPendingAudioInputUninstall(false)}
      />
    </div>
  );
}
