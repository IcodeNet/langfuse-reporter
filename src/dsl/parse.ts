import { isDateOnly, parseCalendarDate } from '../config/calendar-date.js';
import { fieldsOf, findField, operatorsFor } from './fields.js';
import { didYouMean } from './suggest.js';
import { tokenize, type Token } from './tokenize.js';
import {
  QueryError,
  type CmpOp,
  type Expr,
  type FieldSpec,
  type ParseContext,
  type Scalar,
} from './types.js';

/** Deep enough for any real filter, far below the point where recursive descent overflows the stack. */
const MAX_NESTING = 64;
/** A chain of AND/OR builds a tree as deep as it is long, and the evaluator walks it recursively. */
const MAX_CONDITIONS = 200;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RELATIVE = /^-(\d+)([dh])$/;

interface DateValue {
  epochMs: number;
  dateOnly: boolean;
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseDateValue(text: string, now: Date, position: number): DateValue {
  const lower = text.toLowerCase();
  if (lower === 'today') return { epochMs: startOfUtcDay(now), dateOnly: true };
  if (lower === 'yesterday') return { epochMs: startOfUtcDay(now) - MS_PER_DAY, dateOnly: true };
  const relative = RELATIVE.exec(lower);
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = relative[2] === 'd' ? MS_PER_DAY : MS_PER_DAY / 24;
    return { epochMs: now.getTime() - amount * unitMs, dateOnly: false };
  }
  const epochMs = parseCalendarDate(text);
  if (Number.isNaN(epochMs)) {
    throw new QueryError(
      `"${text}" is not a real date. Use 2026-09-01, 2026-09-01T10:00:00Z, today, yesterday, -7d or -12h`,
      position,
    );
  }
  return { epochMs, dateOnly: isDateOnly(text) };
}

/** `=` and `!=` on a date with no time mean the whole UTC day, so they become a range. */
function wholeDayEquality(field: string, op: CmpOp, value: DateValue): Expr | undefined {
  if (!value.dateOnly) return undefined;
  if (op !== '=' && op !== '!=') return undefined;
  const start: Expr = { kind: 'cmp', field, op: op === '=' ? '>=' : '<', value: value.epochMs };
  const end: Expr = {
    kind: 'cmp',
    field,
    op: op === '=' ? '<=' : '>',
    value: value.epochMs + MS_PER_DAY - 1,
  };
  return { kind: op === '=' ? 'and' : 'or', left: start, right: end };
}

function dateBound(op: CmpOp, value: DateValue): number {
  const coversWholeDay = value.dateOnly && (op === '<=' || op === '>');
  return coversWholeDay ? value.epochMs + MS_PER_DAY - 1 : value.epochMs;
}

export function allowedValues(
  field: FieldSpec,
  context: ParseContext,
): readonly string[] | undefined {
  return field.values ?? context.dynamicValues?.[field.name];
}

interface ValueRequest {
  field: FieldSpec;
  op: CmpOp;
  token: Token;
}

function coerceValue({ field, op, token }: ValueRequest, context: ParseContext): Scalar {
  if (field.type === 'date') {
    return dateBound(op, parseDateValue(token.text, context.now, token.start));
  }
  if (field.type === 'boolean') {
    const lower = token.text.toLowerCase();
    if (lower !== 'true' && lower !== 'false') {
      throw new QueryError(`${field.name} takes true or false, got "${token.text}"`, token.start);
    }
    return lower === 'true';
  }
  const allowed = allowedValues(field, context);
  if (field.type === 'enum' && allowed) {
    const match = allowed.find((value) => value.toLowerCase() === token.text.toLowerCase());
    if (!match) {
      throw new QueryError(
        `"${token.text}" is not a valid ${field.name}.${didYouMean(token.text, allowed)} Valid: ${allowed.join(', ')}`,
        token.start,
      );
    }
    return match;
  }
  return token.text;
}

function normaliseOperator(token: Token, upperText: string): CmpOp | 'in' {
  if (upperText === 'CONTAINS') return 'contains';
  if (upperText === 'IN') return 'in';
  return token.text as CmpOp;
}

class Parser {
  private index = 0;
  private depth = 0;
  private conditions = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly context: ParseContext,
    private readonly inputLength: number,
  ) {}

  parse(): Expr {
    const expr = this.parseOr();
    const extra = this.peek();
    if (extra)
      throw new QueryError(
        `Unexpected "${extra.text}". Expected AND, OR or end of query`,
        extra.start,
      );
    return expr;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(expected: string): Token {
    const token = this.tokens[this.index++];
    if (!token) throw new QueryError(`Query ended early. Expected ${expected}`, this.inputLength);
    return token;
  }

  private isKeyword(token: Token | undefined, keyword: string): boolean {
    return token?.kind === 'word' && token.text.toUpperCase() === keyword;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isKeyword(this.peek(), 'OR')) {
      this.index++;
      left = { kind: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.isKeyword(this.peek(), 'AND')) {
      this.index++;
      left = { kind: 'and', left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Expr {
    if (!this.isKeyword(this.peek(), 'NOT')) return this.parsePrimary();
    const notToken = this.tokens[this.index];
    this.index++;
    return this.nested(notToken, () => ({ kind: 'not', operand: this.parseNot() }));
  }

  /** Runs `parse` one level deeper, refusing filters nested beyond what a person would write. */
  private nested(at: Token | undefined, parse: () => Expr): Expr {
    if (this.depth >= MAX_NESTING) {
      throw new QueryError(
        `Filter is nested more than ${MAX_NESTING} levels deep. Simplify the NOT and bracket groups`,
        at?.start ?? this.inputLength,
      );
    }
    this.depth++;
    try {
      return parse();
    } finally {
      this.depth--;
    }
  }

  private parsePrimary(): Expr {
    const open = this.peek();
    if (open?.kind !== 'lparen') return this.parseComparison();
    this.index++;
    return this.nested(open, () => {
      const inner = this.parseOr();
      const close = this.next('")"');
      if (close.kind !== 'rparen')
        throw new QueryError(`Expected ")" but found "${close.text}"`, close.start);
      return inner;
    });
  }

  private parseComparison(): Expr {
    const fieldToken = this.next('a field name');
    if (++this.conditions > MAX_CONDITIONS) {
      throw new QueryError(
        `Filter has more than ${MAX_CONDITIONS} conditions. Use IN (a, b) to match several values`,
        fieldToken.start,
      );
    }
    const fields = fieldsOf(this.context);
    const field = findField(fields, fieldToken.text);
    if (fieldToken.kind !== 'word' || !field) {
      const names = fields.map((f) => f.name);
      throw new QueryError(
        `Unknown field "${fieldToken.text}".${didYouMean(fieldToken.text, names)} Fields: ${names.join(', ')}`,
        fieldToken.start,
      );
    }

    const opToken = this.next('an operator');
    const opText = opToken.text.toUpperCase();
    const isWordToken = opToken.kind === 'word';
    const isWordOp = isWordToken && (opText === 'IN' || opText === 'CONTAINS');
    if (opToken.kind !== 'op' && !isWordOp) {
      throw new QueryError(
        `Expected an operator after ${field.name}. Allowed: ${operatorsFor(field.type).join(', ')}`,
        opToken.start,
      );
    }
    const op = normaliseOperator(opToken, opText);
    if (!operatorsFor(field.type).includes(op)) {
      throw new QueryError(
        `${field.name} does not support ${op.toUpperCase()}. Allowed: ${operatorsFor(field.type).join(', ')}`,
        opToken.start,
      );
    }

    if (op === 'in') return { kind: 'in', field: field.name, values: this.parseList(field) };
    const valueToken = this.next(`a value for ${field.name}`);
    if (valueToken.kind !== 'word' && valueToken.kind !== 'string') {
      throw new QueryError(
        `Expected a value for ${field.name} but found "${valueToken.text}"`,
        valueToken.start,
      );
    }
    if (field.type === 'date') {
      const date = parseDateValue(valueToken.text, this.context.now, valueToken.start);
      const range = wholeDayEquality(field.name, op, date);
      if (range) return range;
    }
    return {
      kind: 'cmp',
      field: field.name,
      op,
      value: coerceValue({ field, op, token: valueToken }, this.context),
    };
  }

  private parseList(field: FieldSpec): Scalar[] {
    const open = this.next('"("');
    if (open.kind !== 'lparen') throw new QueryError('IN needs a list: IN (a, b)', open.start);
    const values: Scalar[] = [];
    for (;;) {
      const valueToken = this.next('a value');
      if (valueToken.kind !== 'word' && valueToken.kind !== 'string') {
        throw new QueryError(`Expected a value but found "${valueToken.text}"`, valueToken.start);
      }
      values.push(coerceValue({ field, op: '=', token: valueToken }, this.context));
      const separator = this.next('"," or ")"');
      if (separator.kind === 'rparen') return values;
      if (separator.kind !== 'comma')
        throw new QueryError(`Expected "," or ")" but found "${separator.text}"`, separator.start);
    }
  }
}

export function parseQuery(input: string, context: ParseContext): Expr | undefined {
  if (input.trim() === '') return undefined;
  return new Parser(tokenize(input), context, input.length).parse();
}

/** Renders a QueryError with a caret under the offending position. */
export function formatQueryError(input: string, error: QueryError): string {
  return `${input}\n${' '.repeat(error.position)}^ ${error.message}`;
}
