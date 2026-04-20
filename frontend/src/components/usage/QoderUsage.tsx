const QODER_USAGE_URL = 'https://qoder.com/account/usage';

const usageLinkClassName = [
  'text-link hover:underline',
  'focus:outline-none',
  'focus-visible:rounded-[3px]',
  'focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]',
].join(' ');

export function QoderUsage() {
  return (
    <div className="text-foreground-secondary">
      Usage quotas:{' '}
      <button
        type="button"
        onClick={() => window.__openUrl?.(QODER_USAGE_URL)}
        className={usageLinkClassName}
      >
        {QODER_USAGE_URL}
      </button>
    </div>
  );
}
