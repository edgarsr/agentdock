const usageLinkClassName = 'text-link hover:underline focus:outline-none focus-visible:rounded-[3px] focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]';

export function CursorUsage() {
  return (
    <div className="text-foreground-secondary">
      Usage quotas: <span></span>
        <button type="button" onClick={() => window.__openUrl?.('https://cursor.com/dashboard/spending')} className={usageLinkClassName}>
            https://cursor.com/dashboard/spending
        </button>
    </div>
  );
}
