export const chatFocusClassName = [
  'rounded-[4px]',
  'focus:outline-none',
  'focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]',
].join(' ');

export const chatInsetFocusClassName = [
  chatFocusClassName,
  'focus-visible:shadow-[inset_0_0_0_1px_var(--ide-Button-default-focusColor)]',
].join(' ');
