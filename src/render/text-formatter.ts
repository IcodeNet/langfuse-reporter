/** What a formatter needs to know about where the text is going. */
export interface FormatContext {
  /** Width of the output in terminal cells; formatters wrap prose to it. */
  columns: number;
  /** True when the output may carry colour and styling. */
  styled: boolean;
}

/**
 * The port: turns a block of text (usually markdown from a model or the docs) into text ready
 * to print. Adapters in ./adapters implement it, so a new target (Slack, HTML, Teams) is one new
 * file and nothing that calls `format` changes.
 */
export interface TextFormatter {
  /** Short name, used in tests and in the picker. */
  readonly name: string;
  format: (text: string, context: FormatContext) => string;
}
