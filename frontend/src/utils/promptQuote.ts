const QUOTE_TAG = 'quoted_assistant_text';

/** The tag tells the agent that the text is quoted from its earlier response, not written by the user. */
export function quotePromptText(quote: string): string {
  return `\n<${QUOTE_TAG}>\n${quote}\n</${QUOTE_TAG}>\n`;
}
