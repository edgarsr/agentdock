import { Settings2 } from 'lucide-react';

export function SettingsView() {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-foreground/80">
          <Settings2 size={14} />
          <span className="font-medium">Settings</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex h-full items-center justify-center px-4">
          <div className="flex flex-col items-center gap-2 text-foreground/30">
            <Settings2 size={28} strokeWidth={1.5} />
            <span>Settings</span>
          </div>
        </div>
      </div>
    </div>
  );
}
