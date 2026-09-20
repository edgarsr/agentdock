import { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import {
  AgentOption,
  AudioTranscriptionSettings,
  GitCommitGenerationSettings as GitCommitGenerationSettingsValue,
  GlobalSettingsPayload
} from '../types/chat';
import { DEFAULT_SIDEBAR_EXPANDED_SECTIONS } from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import { AudioTranscriptionSettingsView } from './audio/AudioTranscriptionSettingsView';
import { normalizeAudioTranscriptionProvider } from './audio/audioTranscription';
import { GitCommitGenerationSettings } from './settings/GitCommitGenerationSettings';
import { SettingsCheckbox, SettingsField, SettingsSection } from './settings/SettingsLayout';
import { Tooltip } from './chat/shared/Tooltip';
import { SectionTitle } from './ui/SectionTitle';
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

const UI_ZOOM_PRESETS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
const SIDEBAR_POSITION_OPTIONS: DropdownOption[] = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
];

function normalizeUiZoomPercent(value: unknown): number {
  const percent = Math.round(Number(value));
  if (!Number.isFinite(percent)) return 100;
  return Math.max(25, Math.min(500, percent));
}

function zoomSelectOptions(currentPercent: number): DropdownOption[] {
  const percents = UI_ZOOM_PRESETS.includes(currentPercent)
    ? UI_ZOOM_PRESETS
    : [...UI_ZOOM_PRESETS, currentPercent].sort((left, right) => left - right);
  return percents.map((percent) => ({
    value: String(percent),
    label: `${percent}%`
  }));
}

function readUiZoom() {
  (
    window as Window & { __agentDockInvoke?: (name: string, payload?: string) => void }
  ).__agentDockInvoke?.('readUiZoom', '');
}

function normalizeGlobalSettings(payload: Partial<GlobalSettingsPayload> | undefined): GlobalSettingsPayload {
  const uiFontSizeOffsetPx = Number.isFinite(payload?.settings?.uiFontSizeOffsetPx)
    ? Math.max(-3, Math.min(3, Math.round(payload!.settings!.uiFontSizeOffsetPx)))
    : 0;
  return {
    settings: {
      audioNotificationsEnabled: payload?.settings?.audioNotificationsEnabled ?? true,
      uiFontSizeOffsetPx,
      uiZoomPercent: normalizeUiZoomPercent(payload?.settings?.uiZoomPercent),
      userMessageBackgroundStyle: payload?.settings?.userMessageBackgroundStyle === 'custom' || userMessageBackgroundOptions.some(
        (option) => option.id === payload?.settings?.userMessageBackgroundStyle
      )
        ? payload!.settings!.userMessageBackgroundStyle
        : 'default',
      userMessageCustomColor: /^#[0-9a-fA-F]{6}$/.test(payload?.settings?.userMessageCustomColor ?? '')
        ? payload!.settings!.userMessageCustomColor : '#193d70',
      audioTranscription: {
        provider: normalizeAudioTranscriptionProvider(payload?.settings?.audioTranscription?.provider),
        language: payload?.settings?.audioTranscription?.language ?? 'auto',
        providers: payload?.settings?.audioTranscription?.providers ?? {}
      },
      gitCommitGeneration: normalizeGitCommitGenerationSettings(payload?.settings?.gitCommitGeneration),
      quotaWidgetEnabled: payload?.settings?.quotaWidgetEnabled ?? false,
      openInEditor: payload?.settings?.openInEditor ?? true,
      sidebarEnabled: payload?.settings?.sidebarEnabled ?? true,
      sidebarPosition: payload?.settings?.sidebarPosition === 'right' ? 'right' : 'left',
      sidebarExpandedSections: Array.isArray(payload?.settings?.sidebarExpandedSections)
        ? payload.settings.sidebarExpandedSections
        : [...DEFAULT_SIDEBAR_EXPANDED_SECTIONS]
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
    id: 'blue-highlight',
    background: 'var(--ide-user-message-blue-highlight-bg)',
    toneClass: 'bg-user-message-blue-highlight'
  },
  {
    id: 'blue',
    background: 'var(--ide-user-message-blue-bg)',
    toneClass: 'bg-user-message-blue'
  },
  { id: 'accent', background: 'var(--ide-List-selectionBackground)', toneClass: 'bg-accent' },
  {
    id: 'background-secondary',
    background: 'var(--ide-background-secondary)',
    toneClass: 'bg-background-secondary'
  },
];

function applyUserMessageTheme(styleId: GlobalSettingsPayload['settings']['userMessageBackgroundStyle'], customColor: string) {
  const selected =
    userMessageBackgroundOptions.find((option) => option.id === styleId) ?? userMessageBackgroundOptions[0];
  document.documentElement.style.setProperty('--ide-user-message-custom-bg', customColor);
  document.documentElement.style.setProperty('--user-message-bg', styleId === 'custom' ? 'var(--ide-user-message-custom-bg)' : selected.background);
}

export function SettingsView() {
  const [globalSettings, setGlobalSettings] = useState<GlobalSettingsPayload>(() =>
    normalizeGlobalSettings(ACPBridge.getGlobalSettingsSnapshot())
  );
  const [installedAgents, setInstalledAgents] = useState<AgentOption[]>([]);
  const [uiFontSizeBasePx, setUiFontSizeBasePx] = useState(() => readIdeFontSizePx());
  const liveZoomRef = useRef<number | null>(null);
  const persistLiveZoomRef = useRef(false);
  const uiFontSizeSelectOptions: DropdownOption[] = Array.from({ length: 7 }, (_, index) => {
    const offset = index - 3;
    const px = uiFontSizeBasePx + offset;
    return { value: String(offset), label: `${px}px` };
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
    applyUserMessageTheme(globalSettings.settings.userMessageBackgroundStyle, globalSettings.settings.userMessageCustomColor);
  }, [globalSettings.settings.userMessageBackgroundStyle, globalSettings.settings.userMessageCustomColor]);

  useEffect(() => {
    const requestSettings = () => {
      ACPBridge.requestAdapters();
    };

    const cleanupGlobalSettings = ACPBridge.onGlobalSettings((e) => {
      const normalized = normalizeGlobalSettings(e.detail?.payload);
      if (liveZoomRef.current != null) {
        normalized.settings.uiZoomPercent = liveZoomRef.current;
      }
      setGlobalSettings(normalized);
    });
    const onUiZoom = (event: Event) => {
      const percent = Number((event as CustomEvent).detail);
      if (!Number.isFinite(percent)) return;
      liveZoomRef.current = percent;
      setGlobalSettings((prev) => {
        const next = { ...prev.settings, uiZoomPercent: percent };
        if (persistLiveZoomRef.current) {
          ACPBridge.saveGlobalSettings(next);
        }
        return { ...prev, settings: next };
      });
    };
    window.addEventListener('agent-dock-ui-zoom', onUiZoom);
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

    persistLiveZoomRef.current = false;
    readUiZoom();

    let zoomReadTimer: number | undefined;
    const scheduleZoomRead = () => {
      persistLiveZoomRef.current = true;
      window.clearTimeout(zoomReadTimer);
      zoomReadTimer = window.setTimeout(() => readUiZoom(), 50);
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      scheduleZoomRead();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (
        event.code !== 'Equal' &&
        event.code !== 'Minus' &&
        event.code !== 'Digit0' &&
        event.code !== 'NumpadAdd' &&
        event.code !== 'NumpadSubtract' &&
        event.code !== 'Numpad0'
      ) {
        return;
      }
      scheduleZoomRead();
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      cleanupGlobalSettings();
      window.removeEventListener('agent-dock-ui-zoom', onUiZoom);
      cleanupAdapters();
      window.removeEventListener('settings-bridge-ready', handleBridgeReady);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(zoomReadTimer);
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
        <div className='mx-auto flex min-h-full w-full max-w-app-content flex-col'>
          <SectionTitle>Settings</SectionTitle>
          <div className='flex flex-col gap-8 px-4 pb-8 text-ide-small'>
          <SettingsSection title='Appearance' compact>
            <SettingsCheckbox
              title='Open in Editor'
              description='Show the plugin as an editor tab instead of the side tool window'
              checked={globalSettings.settings.openInEditor}
              onToggle={() => updateGlobalSettings({ openInEditor: !globalSettings.settings.openInEditor })}
              ariaLabel='Open in the editor'
            />

            <SettingsCheckbox
              title='Use Sidebar Layout'
              description='Use the sidebar for navigation instead of the horizontal top tabbar'
              checked={globalSettings.settings.sidebarEnabled}
              onToggle={() => updateGlobalSettings({ sidebarEnabled: !globalSettings.settings.sidebarEnabled })}
              ariaLabel='Use sidebar layout'
            />

            <SettingsField label='Sidebar Position' colon>
              <DropdownSelect
                value={globalSettings.settings.sidebarPosition}
                onChange={(value) => updateGlobalSettings({
                  sidebarPosition: value === 'left' ? 'left' : 'right'
                })}
                options={SIDEBAR_POSITION_OPTIONS}
                disabled={!globalSettings.settings.sidebarEnabled}
                className='max-w-full'
              />
            </SettingsField>

            <SettingsField label='Zoom' colon>
              <DropdownSelect
                value={String(globalSettings.settings.uiZoomPercent)}
                onChange={(value) => {
                  const percent = Number(value);
                  liveZoomRef.current = percent;
                  persistLiveZoomRef.current = false;
                  updateGlobalSettings({ uiZoomPercent: percent });
                }}
                options={zoomSelectOptions(globalSettings.settings.uiZoomPercent)}
                className='max-w-full'
              />
            </SettingsField>

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
                <Tooltip variant='minimal' content='Choose custom color'>
                  <label
                    style={{ backgroundColor: 'var(--ide-user-message-custom-bg)' }}
                    className={`relative flex h-8 w-8 items-center justify-center rounded-[4px] border focus-within:ring-1 focus-within:ring-[var(--ide-Button-default-focusColor)] ${
                      globalSettings.settings.userMessageBackgroundStyle === 'custom'
                        ? 'border-[var(--ide-Button-focusedBorderColor)] shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]'
                        : 'border-border'
                    }`}
                  >
                    <Palette size={16} aria-hidden='true' />
                    <input
                      type='color'
                      aria-label='Custom message background'
                      value={globalSettings.settings.userMessageCustomColor}
                      onClick={() => updateGlobalSettings({ userMessageBackgroundStyle: 'custom' })}
                      onChange={(event) => updateGlobalSettings({
                        userMessageBackgroundStyle: 'custom',
                        userMessageCustomColor: event.target.value
                      })}
                      className='absolute inset-0 h-full w-full cursor-pointer opacity-0'
                    />
                  </label>
                </Tooltip>
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
    </div>
  );
}
