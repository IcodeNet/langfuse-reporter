import { stripControlCharacters } from '../../ui/untrusted-text.js';
import type { TextFormatter } from '../text-formatter.js';

/** Keeps the text as it is for pipes and CI, minus terminal control codes, which a saved file could replay later. */
export const passthroughFormatter: TextFormatter = {
  name: 'passthrough',
  format: (text) => stripControlCharacters(text),
};
