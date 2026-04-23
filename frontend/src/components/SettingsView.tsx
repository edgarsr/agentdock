import { useEffect, useState } from 'react';
import { AgentOption, AudioTranscriptionFeatureState, AudioTranscriptionSettings, GitCommitGenerationSettings as GitCommitGenerationSettingsValue, GlobalSettingsPayload } from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import ConfirmationModal from './ConfirmationModal';
import { GitCommitGenerationSettings } from './settings/GitCommitGenerationSettings';
import { SettingsCardShell } from './settings/SettingsCardShell';
import { SettingsSelectCard } from './settings/SettingsSelectCard';
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
  },
};

function SettingsLoadingSpinner({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return <div className={`${className} shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin`} />;
}

function normalizeGitCommitGenerationSettings(payload: Partial<GitCommitGenerationSettingsValue> | undefined): GitCommitGenerationSettingsValue {
  return {
    enabled: Boolean(payload?.enabled),
    adapterId: payload?.adapterId?.trim() ?? '',
    modelId: payload?.modelId?.trim() ?? '',
    instructions: payload?.instructions ?? '',
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
      userMessageBackgroundStyle: userMessageBackgroundOptions.some((option) => option.id === payload?.settings?.userMessageBackgroundStyle)
        ? payload!.settings!.userMessageBackgroundStyle
        : 'default',
      audioTranscription: payload?.settings?.audioTranscription ?? { language: 'auto' },
      gitCommitGeneration: normalizeGitCommitGenerationSettings(payload?.settings?.gitCommitGeneration),
    },
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
  { id: 'default', background: 'var(--ide-user-message-default-bg)', toneClass: 'bg-[var(--ide-user-message-default-bg)]' },
  { id: 'background-secondary', background: 'var(--ide-background-secondary)', toneClass: 'bg-background-secondary' },
  { id: 'primary', background: 'var(--ide-Button-default-startBackground)', toneClass: 'bg-primary' },
  { id: 'secondary', background: 'var(--ide-Button-startBackground)', toneClass: 'bg-secondary' },
  { id: 'accent', background: 'var(--ide-List-selectionBackground)', toneClass: 'bg-accent' },
  { id: 'input', background: 'var(--ide-TextField-background)', toneClass: 'bg-input' },
  { id: 'editor-bg', background: 'var(--ide-editor-bg)', toneClass: 'bg-[var(--ide-editor-bg)]' },
];

const emptyState: AudioTranscriptionFeatureState = {
  id: 'whisper-transcription',
  title: 'Audio Input',
  installed: false,
  installing: false,
  supported: false,
  status: 'Loading',
  detail: '',
  installPath: '',
};

const whisperLanguageOptions: DropdownOption[] = [
  { value: 'auto', label: 'auto' },
  { value: 'en', label: 'English (en)' },
  { value: 'de', label: 'German (de)' },
  { value: 'lv', label: 'Latvian (lv)' },
  { value: 'fr', label: 'French (fr)' },
  { value: 'es', label: 'Spanish (es)' },
];

function applyUserMessageTheme(styleId: GlobalSettingsPayload['settings']['userMessageBackgroundStyle']) {
  const selected = userMessageBackgroundOptions.find((option) => option.id === styleId) ?? userMessageBackgroundOptions[0];
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
      label: offset === 0 ? `${px}px (default)` : `${px}px`,
    };
  });
  const uiFontSizeSelectOptions: DropdownOption[] = uiFontSizeOptions.map((option) => ({
    value: String(option.offset),
    label: option.label,
  }));

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-font-size-offset', `${globalSettings.settings.uiFontSizeOffsetPx}px`);
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
    setGlobalSettings(prev => ({ ...prev, settings: next }));
    ACPBridge.saveGlobalSettings(next);
  };

  const handleAudioNotificationsChange = (audioNotificationsEnabled: boolean) => {
    const next = { ...globalSettings.settings, audioNotificationsEnabled };
    setGlobalSettings(prev => ({ ...prev, settings: next }));
    ACPBridge.saveGlobalSettings(next);
  };

  const handleUiFontSizeChange = (uiFontSizeOffsetPx: number) => {
    const next = { ...globalSettings.settings, uiFontSizeOffsetPx };
    setGlobalSettings(prev => ({ ...prev, settings: next }));
    ACPBridge.saveGlobalSettings(next);
  };

  const handleUserMessageBackgroundStyleChange = (userMessageBackgroundStyle: GlobalSettingsPayload['settings']['userMessageBackgroundStyle']) => {
    const next = { ...globalSettings.settings, userMessageBackgroundStyle };
    setGlobalSettings(prev => ({ ...prev, settings: next }));
    ACPBridge.saveGlobalSettings(next);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto w-full px-2 py-2">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col divide-y divide-border">

          <SettingsSelectCard title="Base Font Size">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ide-small text-foreground-secondary">Size: </span>
              <DropdownSelect
                value={String(globalSettings.settings.uiFontSizeOffsetPx)}
                onChange={(value) => handleUiFontSizeChange(Number(value))}
                options={uiFontSizeSelectOptions}
                className="min-w-[180px]"
              />
            </div>
          </SettingsSelectCard>

          <SettingsCardShell
            title="User Message Background"
            description="Choose the background color used for your chat messages:"
          >
            <div className="mt-2 flex flex-wrap gap-1">
              {userMessageBackgroundOptions.map((option) => {
                const selected = globalSettings.settings.userMessageBackgroundStyle === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleUserMessageBackgroundStyleChange(option.id)}
                    aria-pressed={selected}
                    className={`h-7 w-7 rounded-[4px] border border-[var(--ide-Button-disabledBorderColor)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] ${
                      selected
                        ? 'shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]'
                        : ''
                    }`}
                  >
                    <span className={`block h-full w-full rounded-[4px] ${option.toneClass}`} />
                    <span className="sr-only">{option.id}</span>
                  </button>
                );
              })}
            </div>
          </SettingsCardShell>

          <SettingsToggleCard
            title="Audio Notifications"
            description="Play sounds for new assistant messages and permission requests"
            enabled={globalSettings.settings.audioNotificationsEnabled}
            onToggle={() => handleAudioNotificationsChange(!globalSettings.settings.audioNotificationsEnabled)}
            ariaLabel="Enable audio notifications"
          />

          <GitCommitGenerationSettings
            settings={globalSettings.settings.gitCommitGeneration}
            installedAgents={installedAgents}
            onChange={handleGitCommitGenerationChange}
          />

          {feature.supported && (
            <SettingsCardShell title="Audio Input">
              {showAudioInputDetails && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ide-small text-foreground-secondary">Language:</span>
                    <DropdownSelect
                      value={settings.language}
                      onChange={handleLanguageChange}
                      options={whisperLanguageOptions}
                      disabled={!feature.installed}
                    />
                  </div>
                  {feature.installed && feature.installPath && (
                    <div className="break-all text-foreground-secondary">
                      Path: <span className="font-mono">{feature.installPath}</span>
                    </div>
                  )}
                  <div className="text-foreground-secondary">
                    Status: {feature.status}
                  </div>
                </div>
              )}
              <div>
                <Button
                  onClick={handleAudioInputAction}
                  disabled={feature.installing || (!feature.installed && !feature.supported)}
                  variant={feature.installed ? 'accentOutline' : 'install'}
                  className="text-ide-regular"
                  leftIcon={feature.installing ? <SettingsLoadingSpinner className="w-3 h-3" /> : undefined}
                >
                  <span>{actionLabel}</span>
                </Button>
              </div>
            </SettingsCardShell>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={pendingAudioInputUninstall}
        title="Uninstall Audio Input"
        message="Do you want to uninstall Audio Input?"
        onConfirm={confirmAudioInputUninstall}
        onCancel={() => setPendingAudioInputUninstall(false)}
      />
    </div>
  );
}
