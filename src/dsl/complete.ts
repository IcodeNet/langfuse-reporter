import { allowedValues } from './parse.js';
import { fieldsOf, findField, operatorsFor } from './fields.js';
import { tokenize, type Token } from './tokenize.js';
import { QueryError, type FieldSpec, type ParseContext } from './types.js';

export interface Suggestion {
  /** Text to insert in place of the partial word. */
  insert: string;
  hint: string;
}

type Expecting =
  | { state: 'field' }
  | { state: 'operator'; field: FieldSpec }
  | { state: 'value'; field: FieldSpec }
  | { state: 'list-open'; field: FieldSpec }
  | { state: 'list-value'; field: FieldSpec }
  | { state: 'list-separator'; field: FieldSpec }
  | { state: 'connective' }
  | { state: 'invalid' };

const DATE_HINTS: Suggestion[] = [
  { insert: 'today', hint: 'start of today (UTC)' },
  { insert: 'yesterday', hint: 'start of yesterday (UTC)' },
  { insert: '-7d', hint: '7 days ago' },
  { insert: '-30d', hint: '30 days ago' },
  { insert: '-12h', hint: '12 hours ago' },
];

function isValueToken(token: Token): boolean {
  return token.kind === 'word' || token.kind === 'string';
}

const isWord = (token: Token, keyword: string): boolean =>
  token.kind === 'word' && token.text.toUpperCase() === keyword;

type Transition = (current: Expecting, token: Token, fields: readonly FieldSpec[]) => Expecting;

const INVALID: Expecting = { state: 'invalid' };

function withField(current: Expecting): FieldSpec | undefined {
  return 'field' in current ? current.field : undefined;
}

const TRANSITIONS: Record<Expecting['state'], Transition> = {
  field: (current, token, fields) => {
    if (token.kind === 'lparen' || isWord(token, 'NOT')) return current;
    const field = token.kind === 'word' ? findField(fields, token.text) : undefined;
    return field ? { state: 'operator', field } : INVALID;
  },
  operator: (current, token) => {
    const field = withField(current);
    if (!field) return INVALID;
    if (isWord(token, 'IN')) return { state: 'list-open', field };
    const isComparison = token.kind === 'op' || isWord(token, 'CONTAINS');
    return isComparison ? { state: 'value', field } : INVALID;
  },
  value: (_current, token) => (isValueToken(token) ? { state: 'connective' } : INVALID),
  'list-open': (current, token) => {
    const field = withField(current);
    return field && token.kind === 'lparen' ? { state: 'list-value', field } : INVALID;
  },
  'list-value': (current, token) => {
    const field = withField(current);
    return field && isValueToken(token) ? { state: 'list-separator', field } : INVALID;
  },
  'list-separator': (current, token) => {
    const field = withField(current);
    if (field && token.kind === 'comma') return { state: 'list-value', field };
    return token.kind === 'rparen' ? { state: 'connective' } : INVALID;
  },
  connective: (current, token) => {
    if (token.kind === 'rparen') return current;
    return isWord(token, 'AND') || isWord(token, 'OR') ? { state: 'field' } : INVALID;
  },
  invalid: (current) => current,
};

function advance(fields: readonly FieldSpec[]) {
  return (current: Expecting, token: Token): Expecting =>
    TRANSITIONS[current.state](current, token, fields);
}

function valueSuggestions(field: FieldSpec, context: ParseContext): Suggestion[] {
  if (field.type === 'date') return DATE_HINTS;
  if (field.type === 'text') return [{ insert: '"', hint: 'quote the text to search for' }];
  const values = context.suggestedValues?.[field.name] ?? allowedValues(field, context);
  if (!values) return [{ insert: '', hint: `type a ${field.name} (${field.description})` }];
  return values.map((value) => ({
    insert: value.includes(' ') ? `"${value}"` : value,
    hint: field.name,
  }));
}

function suggestionsFor(expecting: Expecting, context: ParseContext): Suggestion[] {
  switch (expecting.state) {
    case 'field':
      return [
        ...fieldsOf(context).map((field) => ({ insert: field.name, hint: field.description })),
        { insert: 'NOT', hint: 'negate the next condition' },
      ];
    case 'operator':
      return operatorsFor(expecting.field.type).map((op) => ({
        insert: op === 'in' || op === 'contains' ? op.toUpperCase() : op,
        hint: `${expecting.field.name} ${op}`,
      }));
    case 'value':
    case 'list-value':
      return valueSuggestions(expecting.field, context);
    case 'list-open':
      return [{ insert: '(', hint: 'start the list: IN (a, b)' }];
    case 'list-separator':
      return [
        { insert: ',', hint: 'add another value' },
        { insert: ')', hint: 'close the list' },
      ];
    case 'connective':
      return [
        { insert: 'AND', hint: 'both conditions must match' },
        { insert: 'OR', hint: 'either condition may match' },
        { insert: ')', hint: 'close a group' },
      ];
    case 'invalid':
      return [];
  }
}

export interface CompletionResult {
  /** Offset in the input where the partial word starts; replace from here to the end. */
  replaceFrom: number;
  suggestions: Suggestion[];
}

/** Suggests what can legally come next at the end of `input` (the cursor is always at the end). */
export function complete(input: string, context: ParseContext): CompletionResult {
  let tokens: Token[];
  try {
    tokens = tokenize(input);
  } catch (err) {
    if (err instanceof QueryError) return { replaceFrom: input.length, suggestions: [] };
    throw err;
  }

  const endsWithSpace = input.length === 0 || /\s$/.test(input);
  const last = tokens.at(-1);
  const hasPartialToken = !endsWithSpace && last !== undefined;
  const typingWord = hasPartialToken && (last.kind === 'word' || last.kind === 'op');
  const finished = typingWord ? tokens.slice(0, -1) : tokens;
  const partial = typingWord ? last.text : '';

  const expecting = finished.reduce<Expecting>(advance(fieldsOf(context)), { state: 'field' });
  const prefix = partial.toLowerCase().replace(/^["']/, '');
  const suggestions = suggestionsFor(expecting, context).filter(
    (suggestion) => suggestion.insert.toLowerCase().startsWith(prefix) || suggestion.insert === '',
  );
  return { replaceFrom: typingWord ? last.start : input.length, suggestions };
}
