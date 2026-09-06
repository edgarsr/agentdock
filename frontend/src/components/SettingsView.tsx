import { useEffect, useState } from 'react';
import {
  AgentOption,
  AudioTranscriptionSettings,
  GitCommitGenerationSettings as GitCommitGenerationSettingsValue,
  GlobalSettingsPayload
} from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import { AudioTranscriptionSettingsView } from './audio/AudioTranscriptionSettingsView';
import { normalizeAudioTranscriptionProvider } from './audio/audioTranscription';
import { GitCommitGenerationSettings } from './settings/GitCommitGenerationSettings';
import { SettingsCheckbox, SettingsField, SettingsSection } from './settings/SettingsLayout';
import { DropdownOption, DropdownSelect } from './ui/DropdownSelect';

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
      audioTranscription: {
        provider: normalizeAudioTranscriptionProvider(payload?.settings?.audioTranscription?.provider),
        language: payload?.settings?.audioTranscription?.language ?? 'auto',
        providers: payload?.settings?.audioTranscription?.providers ?? {}
      },
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

function applyUserMessageTheme(styleId: GlobalSettingsPayload['settings']['userMessageBackgroundStyle']) {
  const selected =
    userMessageBackgroundOptions.find((option) => option.id === styleId) ?? userMessageBackgroundOptions[0];
  document.documentElement.style.setProperty('--user-message-bg', selected.background);
}

export function SettingsView() {
  const [globalSettings, setGlobalSettings] = useState<GlobalSettingsPayload>(() =>
    normalizeGlobalSettings(ACPBridge.getGlobalSettingsSnapshot())
  );
  const [installedAgents, setInstalledAgents] = useState<AgentOption[]>([]);
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
      ACPBridge.requestAdapters();
    };

    const cleanupGlobalSettings = ACPBridge.onGlobalSettings((e) => {
      const normalized = normalizeGlobalSettings(e.detail?.payload);
      setGlobalSettings(normalized);
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
      cleanupGlobalSettings();
      cleanupAdapters();
      window.removeEventListener('settings-bridge-ready', handleBridgeReady);
    };
  }, []);

  const updateGlobalSettings = (patch: Partial<GlobalSettingsPayload['settings']>) => {
    const next = { ...globalSettings.settings, ...patch };
    setGlobalSettings((prev) => ({ ...prev, settings: next }));
    ACPBridge.saveGlobalSettings(next);
  };

  const updateAudioSettings = (audioTranscription: AudioTranscriptionSettings) => {
    setGlobalSettings((prev) => ({
      ...prev,
      settings: { ...prev.settings, audioTranscription }
    }));
  };

  const saveAudioSettings = (audioTranscription: AudioTranscriptionSettings) => {
    const next = { ...globalSettings.settings, audioTranscription };
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

          <AudioTranscriptionSettingsView
            settings={globalSettings.settings.audioTranscription}
            onSettingsChange={updateAudioSettings}
            onSettingsSave={saveAudioSettings}
          />
        </div>
      </div>
    </div>
  );
}
