import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
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
import { SettingsCardShell } from './settings/SettingsCardShell';
import { SettingsSelectCard } from './settings/SettingsSelectCard';
import { SettingsSection } from './settings/SettingsSection';
import { SettingsToggleCard } from './settings/SettingsToggleCard';
import { Button } from './ui/Button';
import { DropdownOption, DropdownSelect } from './ui/DropdownSelect';

const defaultGlobalSettings: GlobalSettingsPayload = {
  settings: {
    audioNotificationsEnabled: true,
    uiFontSizeOffsetPx: 0,
    userMessageBackgroundStyle: 'default',
    audioTranscription: { language: 'auto' },
    gitCommitGeneration: { enabled: false, adapterId: '', modelId: '', instructions: '' },
    quotaWidgetEnabled: false
  }
};

function SettingsLoadingSpinner({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <div className={`${className} shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin`} />
  );
}

function normalizeGitCommitGenerationSettings(
  payload: Partial<GitCommitGenerationSettingsValue> | undefined
): GitCommitGenerationSettingsValue {
  return {
    enabled: Boolean(payload?.enabled),
    adapterId: payload?.adapterId?.trim() ?? '',
    modelId: payload?.modelId?.trim() ?? '',
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
  label: string;
  background: string;
  toneClass: string;
}> = [
  {
    id: 'default',
    label: 'Default',
    background: 'var(--ide-user-message-default-bg)',
    toneClass: 'bg-[var(--ide-user-message-default-bg)]'
  },
  {
    id: 'blue',
    label: 'Blue',
    background: 'var(--ide-user-message-blue-bg)',
    toneClass: 'bg-[var(--ide-user-message-blue-bg)]'
  },
  {
    id: 'background-secondary',
    label: 'Secondary',
    background: 'var(--ide-background-secondary)',
    toneClass: 'bg-background-secondary'
  },
  { id: 'primary', label: 'Primary', background: 'var(--ide-Button-default-startBackground)', toneClass: 'bg-primary' },
  { id: 'secondary', label: 'Button', background: 'var(--ide-Button-startBackground)', toneClass: 'bg-secondary' },
  { id: 'accent', label: 'Selection', background: 'var(--ide-List-selectionBackground)', toneClass: 'bg-accent' },
  { id: 'input', label: 'Input', background: 'var(--ide-TextField-background)', toneClass: 'bg-input' },
  {
    id: 'editor-bg',
    label: 'Editor',
    background: 'var(--ide-editor-xbg)',
    toneClass: 'bg-[var(--ide-editor-bg)]'
  }
];

const emptyState: AudioTranscriptionFeatureState = {
  id: 'whisper-transcription',
  title: 'Audio Input',
  installed: false,
  installing: false,
  supported: false,
  status: 'Loading',
  detail: '',
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
  const uiFontSizeOptions = Array.from({ length: 7 }, (_, index) => {
    const offset = index - 3;
    const px = uiFontSizeBasePx + offset;
    return {
      offset,
      label: offset === 0 ? `${px}px (default)` : `${px}px`
    };
  });
  const uiFontSizeSelectOptions: DropdownOption[] = uiFontSizeOptions.map((option) => ({
    value: String(option.offset),
    label: option.label
  }));

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

  const handleGitCommitGenerationChange = (gitCommitGeneration: GitCommitGenerationSettingsValue) => {
    const next = { ...globalSettings.settings, gitCommitGeneration };
    setGlobalSettings((prev) => ({ ...prev, settings: next }));
    ACPBridge.saveGlobalSettings(next);
  };

  const handleAudioNotificationsChange = (audioNotificationsEnabled: boolean) => {
    const next = { ...globalSettings.settings, audioNotificationsEnabled };
    setGlobalSettings((prev) => ({ ...prev, settings: next }));
    ACPBridge.saveGlobalSettings(next);
  };

  const handleQuotaWidgetEnabledChange = (quotaWidgetEnabled: boolean) => {
    const next = { ...globalSettings.settings, quotaWidgetEnabled };
    setGlobalSettings((prev) => ({ ...prev, settings: next }));
    ACPBridge.saveGlobalSettings(next);
  };

  const handleUiFontSizeChange = (uiFontSizeOffsetPx: number) => {
    const next = { ...globalSettings.settings, uiFontSizeOffsetPx };
    setGlobalSettings((prev) => ({ ...prev, settings: next }));
    ACPBridge.saveGlobalSettings(next);
  };

  const handleUserMessageBackgroundStyleChange = (
    userMessageBackgroundStyle: GlobalSettingsPayload['settings']['userMessageBackgroundStyle']
  ) => {
    const next = { ...globalSettings.settings, userMessageBackgroundStyle };
    setGlobalSettings((prev) => ({ ...prev, settings: next }));
    ACPBridge.saveGlobalSettings(next);
  };

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <div className='w-full flex-1 overflow-y-auto'>
        <div className='flex w-full max-w-[840px] flex-col gap-6 px-4 py-4'>
          <h1 className='px-2 text-ide-h4 font-medium text-foreground'>Settings</h1>

          <SettingsSection title='APPEARANCE'>
            <SettingsSelectCard
              title='Interface Font Size'
              description='Adjust the size of text and controls in Agent Dock'
            >
              <DropdownSelect
                value={String(globalSettings.settings.uiFontSizeOffsetPx)}
                onChange={(value) => handleUiFontSizeChange(Number(value))}
                options={uiFontSizeSelectOptions}
                className='w-[200px] max-w-[42vw]'
              />
            </SettingsSelectCard>

            <SettingsCardShell
              title='User Message Background'
              description='Choose how your messages appear in chat'
            >
              <div className='grid max-w-[620px] grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-2'>
                {userMessageBackgroundOptions.map((option) => {
                  const selected = globalSettings.settings.userMessageBackgroundStyle === option.id;
                  return (
                    <button
                      key={option.id}
                      type='button'
                      onClick={() => handleUserMessageBackgroundStyleChange(option.id)}
                      aria-pressed={selected}
                      aria-label={`${option.label} message background`}
                      className={`relative min-w-0 rounded-[4px] border p-1.5 text-left focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] ${
                        selected
                          ? 'border-[var(--ide-Button-focusedBorderColor)] shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]'
                          : 'border-[var(--ide-Button-disabledBorderColor)] hover:bg-hover'
                      }`}
                    >
                      <span className='block rounded-[3px] bg-background-secondary p-1.5'>
                        <span className={`ml-auto block h-5 w-4/5 rounded-[3px] border border-border ${option.toneClass}`} />
                      </span>
                      <span className='mt-1.5 block truncate pr-4 text-xs text-foreground'>{option.label}</span>
                      {selected ? (
                        <span className='absolute right-2 bottom-1.5 text-[var(--ide-Hyperlink-linkColor)]'>
                          <Check size={12} strokeWidth={2.5} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </SettingsCardShell>
          </SettingsSection>

          <SettingsSection title='NOTIFICATIONS'>
            <SettingsToggleCard
              title='Audio Notifications'
              description='Play sounds for assistant replies and permission requests'
              enabled={globalSettings.settings.audioNotificationsEnabled}
              onToggle={() => handleAudioNotificationsChange(!globalSettings.settings.audioNotificationsEnabled)}
              ariaLabel='Enable audio notifications'
            />
          </SettingsSection>

          <SettingsSection title='IDE INTEGRATION'>
            <SettingsToggleCard
              title='Status Bar Quota Widget'
              description='Display real-time agent usage quotas in the IDE status bar'
              enabled={globalSettings.settings.quotaWidgetEnabled}
              onToggle={() => handleQuotaWidgetEnabledChange(!globalSettings.settings.quotaWidgetEnabled)}
              ariaLabel='Enable status bar quota widget'
            />

            <GitCommitGenerationSettings
              settings={globalSettings.settings.gitCommitGeneration}
              installedAgents={installedAgents}
              onChange={handleGitCommitGenerationChange}
            />
          </SettingsSection>

          {feature.supported && (
            <SettingsSection title='VOICE INPUT'>
              <SettingsCardShell
                title='Audio Input'
                description='Transcribe microphone input locally using Whisper'
                control={
                  <Button
                    onClick={handleAudioInputAction}
                    disabled={feature.installing || (!feature.installed && !feature.supported)}
                    variant={feature.installed ? 'accentOutline' : 'install'}
                    className='text-ide-regular'
                    leftIcon={feature.installing ? <SettingsLoadingSpinner className='w-3 h-3' /> : undefined}
                  >
                    {actionLabel}
                  </Button>
                }
              >
                {showAudioInputDetails && (
                  <div className='grid max-w-[560px] grid-cols-1 items-center gap-x-3 gap-y-2 min-[420px]:grid-cols-[88px_minmax(0,260px)]'>
                    <span className='text-foreground-secondary'>Status</span>
                    <span>{feature.status}</span>
                    <span className='text-foreground-secondary'>Language</span>
                    <DropdownSelect
                      value={settings.language}
                      onChange={handleLanguageChange}
                      options={whisperLanguageOptions}
                      disabled={!feature.installed}
                      className='w-full'
                    />
                    {feature.installed && feature.installPath && (
                      <div className='mt-1 break-all text-xs text-foreground-secondary min-[420px]:col-span-2'>
                        Installed at <span className='font-mono'>{feature.installPath}</span>
                      </div>
                    )}
                  </div>
                )}
              </SettingsCardShell>
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
