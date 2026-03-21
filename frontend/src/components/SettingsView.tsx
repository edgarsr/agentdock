import { useEffect, useState } from 'react';
import { LoaderCircle, Mic, Settings2 } from 'lucide-react';
import { AudioTranscriptionFeatureState, AudioTranscriptionSettings } from '../types/chat';
import { ACPBridge } from '../utils/bridge';

const emptyState: AudioTranscriptionFeatureState = {
  id: 'whisper-transcription',
  title: 'Whisper',
  installed: false,
  installing: false,
  supported: false,
  status: 'Loading',
  detail: '',
  installPath: '',
};

export function SettingsView() {
  const [feature, setFeature] = useState<AudioTranscriptionFeatureState>(emptyState);
  const [settings, setSettings] = useState<AudioTranscriptionSettings>({ language: 'auto' });

  useEffect(() => {
    const cleanupFeature = ACPBridge.onAudioTranscriptionFeature((e) => {
      setFeature(e.detail.state);
    });
    const cleanupSettings = ACPBridge.onAudioTranscriptionSettings((e) => {
      setSettings(e.detail.settings);
    });
    ACPBridge.loadAudioTranscriptionFeature();
    ACPBridge.loadAudioTranscriptionSettings();
    return () => {
      cleanupFeature();
      cleanupSettings();
    };
  }, []);

  const actionLabel = feature.installed ? 'Uninstall' : 'Install';
  const action = feature.installed
    ? () => ACPBridge.uninstallAudioTranscriptionFeature()
    : () => ACPBridge.installAudioTranscriptionFeature();

  const handleLanguageChange = (language: string) => {
    const next = { language };
    setSettings(next);
    ACPBridge.saveAudioTranscriptionSettings(next);
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-foreground/80">
          <Settings2 size={14} />
          <span className="font-medium">Settings</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4">
          <div className="rounded-ide border border-border bg-background-secondary">
            <div className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-ide border border-border bg-background text-foreground/70">
                  <Mic size={15} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{feature.title}</div>
                  <div className="mt-1 text-xs text-foreground/60">{feature.status}</div>
                  {feature.detail && (
                    <div className="mt-1 break-words text-xs text-foreground/40">{feature.detail}</div>
                  )}
                  {feature.installed && feature.installPath && (
                    <div className="mt-1 break-all font-mono text-[11px] text-foreground/35">{feature.installPath}</div>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <label htmlFor="whisper-language" className="text-xs text-foreground/60">Language</label>
                    <select
                      id="whisper-language"
                      value={settings.language}
                      onChange={(e) => handleLanguageChange(e.target.value)}
                      disabled={!feature.installed}
                      className="rounded-ide border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
                    >
                      <option value="auto">auto</option>
                      <option value="lv">Latvian (lv)</option>
                      <option value="en">English (en)</option>
                      <option value="ru">Russian (ru)</option>
                      <option value="de">German (de)</option>
                      <option value="fr">French (fr)</option>
                      <option value="es">Spanish (es)</option>
                    </select>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={action}
                disabled={feature.installing || (!feature.installed && !feature.supported)}
                className="inline-flex shrink-0 items-center gap-1 rounded-ide border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {feature.installing && <LoaderCircle size={12} className="animate-spin" />}
                <span>{actionLabel}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
