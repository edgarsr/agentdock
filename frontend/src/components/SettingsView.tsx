import { Fragment, useEffect, useRef, useState } from 'react';
import { Check, Copy, Palette } from 'lucide-react';
import {
  AgentOption,
  GitCommitGenerationSettings as GitCommitGenerationSettingsValue,
  GlobalSettingsPayload,
  SettingsSectionType,
  ShortcutSettings
} from '../types/chat';
import { isMac, ShortcutAction } from '../hooks/useShortcuts';
import { useSidebarLayout } from '../hooks/useSidebarLayout';
import { ACPBridge } from '../utils/bridge';
import { AudioTranscriptionSettingsView } from './audio/AudioTranscriptionSettingsView';
import { normalizeAudioTranscriptionProvider, normalizeRecordingLimitSeconds } from './audio/audioTranscription';
import { AudioOutputSettingsView } from './audio/AudioOutputSettingsView';
import { normalizeAudioOutputSettings } from './audio/speechOutput';
import { GitCommitGenerationSettings } from './settings/GitCommitGenerationSettings';
import { SettingsCheckbox, SettingsField, SettingsSection } from './settings/SettingsLayout';
import { Tooltip } from './chat/shared/Tooltip';
import { SectionPage } from './ui/SectionPage';
import { openInBrowser } from './LayoutControls';
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
const CONTENT_MAX_WIDTH_PRESETS = [500, 600, 680, 720, 740, 760, 780, 800, 840, 900, 0];
const SIDEBAR_POSITION_OPTIONS: DropdownOption[] = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
];

const DEFAULT_SHORTCUTS: ShortcutSettings = {
  search: 'F', newChat: '', closeChat: '', history: 'H', manage: '', focusInput: '', cancelPrompt: '', tabNumbers: false
};
const SHORTCUT_LABELS: Array<[ShortcutAction, string]> = [
  ['search', 'Search in chat'],
  ['newChat', 'New chat'],
  ['closeChat', 'Close chat'],
  ['history', 'Chat history'],
  ['manage', 'Open settings'],
  ['focusInput', 'Focus chat input'],
  ['cancelPrompt', 'Cancel prompt'],
];
// Text editing keeps these.
const RESERVED_SHORTCUT_LETTERS = 'ACVXYZ';
const SHORTCUT_MODIFIER = isMac ? 'Cmd' : 'Ctrl';

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

function contentMaxWidthOptions(currentPx: number): DropdownOption[] {
  const widths = CONTENT_MAX_WIDTH_PRESETS.includes(currentPx)
    ? CONTENT_MAX_WIDTH_PRESETS
    : [currentPx, ...CONTENT_MAX_WIDTH_PRESETS];
  return widths.map((width) => ({
    value: String(width),
    label: width ? `${width}px` : 'Unlimited'
  }));
}

function normalizeGlobalSettings(payload: Partial<GlobalSettingsPayload> | undefined): GlobalSettingsPayload {
  return {
    settings: {
      audioNotificationsEnabled: payload?.settings?.audioNotificationsEnabled ?? true,
      uiZoomPercent: normalizeUiZoomPercent(payload?.settings?.uiZoomPercent),
      contentMaxWidthPx: payload?.settings?.contentMaxWidthPx ?? 760,
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
        recordingLimitSeconds: normalizeRecordingLimitSeconds(payload?.settings?.audioTranscription?.recordingLimitSeconds),
        providers: payload?.settings?.audioTranscription?.providers ?? {}
      },
      audioOutput: normalizeAudioOutputSettings(payload?.settings?.audioOutput),
      gitCommitGeneration: normalizeGitCommitGenerationSettings(payload?.settings?.gitCommitGeneration),
      systemInstructionsEnabled: payload?.settings?.systemInstructionsEnabled ?? false,
      quotaWidgetEnabled: payload?.settings?.quotaWidgetEnabled ?? false,
      openInEditor: payload?.settings?.openInEditor ?? true,
      browserAccessEnabled: payload?.settings?.browserAccessEnabled ?? true,
      browserAccessPort: payload?.settings?.browserAccessPort ?? 47823,
      browserAccessCode: payload?.settings?.browserAccessCode ?? null,
      promptNavigationHoverOnly: payload?.settings?.promptNavigationHoverOnly ?? true,
      userMessageDetailsHoverOnly: payload?.settings?.userMessageDetailsHoverOnly ?? false,
      sidebarPosition: payload?.settings?.sidebarPosition === 'right' ? 'right' : 'left',
      historyGroupsExpanded: payload?.settings?.historyGroupsExpanded ?? false,
      rememberModelAndEffort: payload?.settings?.rememberModelAndEffort ?? false,
      approvalMode: payload?.settings?.approvalMode === 'auto' ? 'auto' : 'ask',
      sendMode: payload?.settings?.sendMode === 'ctrl-enter' ? 'ctrl-enter' : 'enter',
      shortcuts: { ...DEFAULT_SHORTCUTS, ...payload?.settings?.shortcuts }
    }
  };
}

const userMessageBackgroundOptions: Array<{
  id: GlobalSettingsPayload['settings']['userMessageBackgroundStyle'];
  toneClass: string;
}> = [
  { id: 'default', toneClass: 'bg-user-message-default' },
  { id: 'blue-highlight', toneClass: 'bg-user-message-blue-highlight' },
  { id: 'blue', toneClass: 'bg-user-message-blue' },
  { id: 'accent', toneClass: 'bg-accent' },
  { id: 'background-secondary', toneClass: 'bg-background-secondary' },
];

export function SettingsView({ section }: { section: SettingsSectionType }) {
  const [globalSettings, setGlobalSettings] = useState<GlobalSettingsPayload>(() =>
    normalizeGlobalSettings(ACPBridge.getGlobalSettingsSnapshot())
  );
  const [sidebarEnabled, setSidebarEnabled] = useSidebarLayout();
  const [installedAgents, setInstalledAgents] = useState<AgentOption[]>([]);
  const [browserAddress, setBrowserAddress] = useState('');
  const [addressCopied, setAddressCopied] = useState(false);
  // Why the last key pressed in a shortcut field was not taken.
  const [shortcutError, setShortcutError] = useState<{ action: ShortcutAction; message: string } | null>(null);
  const liveZoomRef = useRef<number | null>(null);
  const persistLiveZoomRef = useRef(false);
  /** Fields edited in the form but not saved yet, such as a port being typed. */
  const unsavedEditsRef = useRef<Partial<GlobalSettingsPayload['settings']>>({});

  // Settings saved from another chat or project arrive here too, and keep what is being typed.
  useEffect(() => ACPBridge.onGlobalSettings((e) => {
    const normalized = normalizeGlobalSettings(e.detail?.payload);
    if (liveZoomRef.current != null) {
      normalized.settings.uiZoomPercent = liveZoomRef.current;
    }
    setGlobalSettings({ ...normalized, settings: { ...normalized.settings, ...unsavedEditsRef.current } });
  }), []);

  // Git commit message generation offers the installed agents.
  useEffect(() => {
    if (section !== 'general') return;
    const requestAdapters = () => {
      ACPBridge.requestAdapters();
    };
    const cleanupAdapters = ACPBridge.onAdapters((e) => {
      const nextInstalledAgents = Array.isArray(e.detail.adapters)
        ? e.detail.adapters.filter((agent) => agent.downloaded === true)
        : [];
      setInstalledAgents(nextInstalledAgents);
    });

    if (window.__settingsBridgeReady) {
      requestAdapters();
    } else {
      window.addEventListener('settings-bridge-ready', requestAdapters);
    }

    return () => {
      cleanupAdapters();
      window.removeEventListener('settings-bridge-ready', requestAdapters);
    };
  }, [section]);

  useEffect(() => {
    if (section !== 'general') return;
    const onAddress = (event: Event) => setBrowserAddress(String((event as CustomEvent).detail));
    window.addEventListener('agent-dock-browser-address', onAddress);
    window.__readBrowserAddress?.();
    return () => window.removeEventListener('agent-dock-browser-address', onAddress);
  }, [section]);

  useEffect(() => {
    if (section !== 'appearance') return;
    const onUiZoom = (event: Event) => {
      const percent = Number((event as CustomEvent).detail);
      if (!Number.isFinite(percent)) return;
      liveZoomRef.current = percent;
      setGlobalSettings((prev) => {
        if (persistLiveZoomRef.current) {
          ACPBridge.saveGlobalSettings({ uiZoomPercent: percent });
        }
        return { ...prev, settings: { ...prev.settings, uiZoomPercent: percent } };
      });
    };
    window.addEventListener('agent-dock-ui-zoom', onUiZoom);

    persistLiveZoomRef.current = false;
    window.__readUiZoom?.();

    let zoomReadTimer: number | undefined;
    const scheduleZoomRead = () => {
      persistLiveZoomRef.current = true;
      window.clearTimeout(zoomReadTimer);
      zoomReadTimer = window.setTimeout(() => window.__readUiZoom?.(), 50);
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
      window.removeEventListener('agent-dock-ui-zoom', onUiZoom);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(zoomReadTimer);
    };
  }, [section]);

  /** Saves [patch] together with the fields edited before it. */
  const updateGlobalSettings = (patch: Partial<GlobalSettingsPayload['settings']>) => {
    const changes = { ...unsavedEditsRef.current, ...patch };
    unsavedEditsRef.current = {};
    setGlobalSettings((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
    if (Object.keys(changes).length > 0) ACPBridge.saveGlobalSettings(changes);
  };

  /** Updates the form without saving, e.g. while an API key is being typed. */
  const editGlobalSettings = (patch: Partial<GlobalSettingsPayload['settings']>) => {
    unsavedEditsRef.current = { ...unsavedEditsRef.current, ...patch };
    setGlobalSettings((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  };

  return (
    <div className='flex min-h-0 flex-col'>
      <SectionPage padding="pb-12 pt-3">
          <div className='flex flex-col gap-8 px-5 text-ide-small'>
          {section === 'appearance' && (
            <SettingsSection compact>
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
                checked={sidebarEnabled}
                onToggle={() => setSidebarEnabled(!sidebarEnabled)}
                ariaLabel='Use sidebar layout'
              />

              <SettingsCheckbox
                title='Hide prompt navigation on the left side of the chat until hover'
                checked={globalSettings.settings.promptNavigationHoverOnly}
                onToggle={() => updateGlobalSettings({ promptNavigationHoverOnly: !globalSettings.settings.promptNavigationHoverOnly })}
                ariaLabel='Hide prompt navigation on the left side of the chat until hover'
              />

              <SettingsCheckbox
                title='Hide prompt details below user messages until hover'
                checked={globalSettings.settings.userMessageDetailsHoverOnly}
                onToggle={() => updateGlobalSettings({ userMessageDetailsHoverOnly: !globalSettings.settings.userMessageDetailsHoverOnly })}
                ariaLabel='Hide prompt details below user messages until hover'
              />

              <div className='my-1 grid grid-cols-[max-content_max-content] items-center gap-x-2 gap-y-3'>
                <span className='text-foreground'>Sidebar Position:</span>
                <DropdownSelect
                  value={globalSettings.settings.sidebarPosition}
                  onChange={(value) => updateGlobalSettings({
                    sidebarPosition: value === 'left' ? 'left' : 'right'
                  })}
                  options={SIDEBAR_POSITION_OPTIONS}
                  disabled={!sidebarEnabled}
                  className='max-w-full'
                />

                <span className='text-foreground'>Zoom:</span>
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

                <span className='text-foreground'>Content Max Width:</span>
                <DropdownSelect
                  value={String(globalSettings.settings.contentMaxWidthPx)}
                  onChange={(value) => updateGlobalSettings({ contentMaxWidthPx: Number(value) })}
                  options={contentMaxWidthOptions(globalSettings.settings.contentMaxWidthPx)}
                  className='max-w-full'
                />
              </div>

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
          )}

          {section === 'general' && (
            <SettingsSection>
              <SettingsCheckbox
                title='Serve the Plugin to Web Browsers'
                description='Served by the IDE; use Tailscale to reach it remotely'
                checked={globalSettings.settings.browserAccessEnabled}
                onToggle={() => updateGlobalSettings({ browserAccessEnabled: !globalSettings.settings.browserAccessEnabled })}
                ariaLabel='Enable browser access'
              >
                {globalSettings.settings.browserAccessEnabled && (
                  <div className='grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-2 gap-y-4'>
                    <span className='text-foreground'>Port:</span>
                    <input
                      type='text'
                      inputMode='numeric'
                      value={globalSettings.settings.browserAccessPort || ''}
                      onChange={(event) => editGlobalSettings({
                        browserAccessPort: Number(event.target.value.replace(/\D/g, '').slice(0, 5))
                      })}
                      onBlur={() => updateGlobalSettings({})}
                      aria-label='Web server port'
                      className='w-20 max-w-full rounded-[3px]'
                    />
                    <div className='col-span-2 -mt-3 text-ide-small text-foreground-secondary'>
                      If it is in use, the next free port is used automatically
                    </div>
                    <span className='text-foreground'>Access Key:</span>
                    <input
                      type='text'
                      value={globalSettings.settings.browserAccessCode ?? ''}
                      onChange={(event) => editGlobalSettings({
                        browserAccessCode: event.target.value.replace(/[^A-Za-z0-9_-]/g, '')
                      })}
                      onBlur={() => updateGlobalSettings({})}
                      autoComplete='off'
                      spellCheck={false}
                      aria-label='Access key'
                      className='w-44 max-w-full rounded-[3px]'
                    />
                    <div className='col-span-2 -mt-3 text-ide-small text-foreground-secondary'>
                      Needed once per browser, then kept in a cookie
                    </div>
                    {browserAddress && (
                      <>
                        <span className='text-foreground'>Address:</span>
                        <span className='flex min-w-0 items-center gap-1'>
                          {/* A web browser showing the UI is already there, and its "localhost" may be another device. */}
                          {window.__AGENT_DOCK_CLIENT === 'browser' ? (
                            <span className='break-all text-foreground-secondary'>{browserAddress}</span>
                          ) : (
                            <button type='button' onClick={openInBrowser} className='break-all text-left text-link hover:underline'>
                              {browserAddress}
                            </button>
                          )}
                          <Tooltip variant='minimal' content={addressCopied ? 'Copied' : 'Copy'}>
                            <button
                              type='button'
                              onClick={() => navigator.clipboard.writeText(browserAddress).then(() => setAddressCopied(true), () => {})}
                              onMouseLeave={() => setAddressCopied(false)}
                              aria-label='Copy address'
                              className='flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-foreground-secondary
                                hover:bg-hover hover:text-foreground'
                            >
                              {addressCopied ? <Check size={10} aria-hidden='true' /> : <Copy size={10} aria-hidden='true' />}
                            </button>
                          </Tooltip>
                        </span>
                      </>
                    )}
                  </div>
                )}
              </SettingsCheckbox>

              <SettingsCheckbox
                title='Audio Notifications'
                description='Play sounds for new assistant messages and quota limit warnings'
                checked={globalSettings.settings.audioNotificationsEnabled}
                onToggle={() =>
                  updateGlobalSettings({ audioNotificationsEnabled: !globalSettings.settings.audioNotificationsEnabled })
                }
                ariaLabel='Enable audio notifications'
              />

              <AudioTranscriptionSettingsView
                settings={globalSettings.settings.audioTranscription}
                onSettingsChange={(audioTranscription) => editGlobalSettings({ audioTranscription })}
                onSettingsSave={(audioTranscription) => updateGlobalSettings({ audioTranscription })}
              />

              <AudioOutputSettingsView
                settings={globalSettings.settings.audioOutput}
                onSettingsChange={(audioOutput) => editGlobalSettings({ audioOutput })}
                onSettingsSave={(audioOutput) => updateGlobalSettings({ audioOutput })}
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

              <SettingsCheckbox
                title='System Instructions'
                description='Add enabled instructions to the first prompt of each new chat'
                checked={globalSettings.settings.systemInstructionsEnabled}
                onToggle={() =>
                  updateGlobalSettings({ systemInstructionsEnabled: !globalSettings.settings.systemInstructionsEnabled })
                }
                ariaLabel='Enable system instructions'
              />
            </SettingsSection>
          )}

          {section === 'shortcuts' && (
            <SettingsSection>
              <div className='text-foreground-secondary'>
                These shortcuts override the IDE shortcuts while the plugin has focus.
              </div>

              <SettingsCheckbox
                title='Number shortcuts'
                description={`Use ${SHORTCUT_MODIFIER}+1–9 to switch chats`}
                checked={globalSettings.settings.shortcuts.tabNumbers}
                onToggle={() => updateGlobalSettings({
                  shortcuts: { ...globalSettings.settings.shortcuts, tabNumbers: !globalSettings.settings.shortcuts.tabNumbers }
                })}
                ariaLabel='Number shortcuts'
              />

              <div className='grid grid-cols-[max-content_max-content] items-center gap-x-2 gap-y-3'>
                {SHORTCUT_LABELS.map(([action, label]) => (
                  <Fragment key={action}>
                    <span className='text-foreground'>{label}:</span>
                    <span className='flex items-center gap-1 text-foreground'>
                      {SHORTCUT_MODIFIER}+
                      <input
                        type='text'
                        value={globalSettings.settings.shortcuts[action]}
                        onChange={(event) => {
                          const letter = event.target.value.slice(-1).toUpperCase();
                          const shortcuts = globalSettings.settings.shortcuts;
                          const taken = SHORTCUT_LABELS.find(([other]) => other !== action && shortcuts[other] === letter);
                          const error = !letter ? null
                            : !/[A-Z]/.test(letter) ? 'Use a letter'
                            : RESERVED_SHORTCUT_LETTERS.includes(letter) ? 'Kept for text editing'
                            : taken ? `Used by ${taken[1]}` : null;
                          setShortcutError(error ? { action, message: error } : null);
                          if (!error) updateGlobalSettings({ shortcuts: { ...shortcuts, [action]: letter } });
                        }}
                        aria-label={`${label} shortcut letter`}
                        className='w-8 rounded-[3px] text-center'
                      />
                      {shortcutError?.action === action && <span className='text-error'>{shortcutError.message}</span>}
                    </span>
                  </Fragment>
                ))}
              </div>
            </SettingsSection>
          )}
          </div>
      </SectionPage>
    </div>
  );
}
