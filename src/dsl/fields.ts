import { DEFAULT_CONVENTIONS } from '../config/config-schema.js';
import type { CmpOp, FieldSpec, FieldType } from './types.js';

/** The filter fields. `category` takes its values from the reasons in the config. */
export function buildFields(reasons: readonly string[]): readonly FieldSpec[] {
  return [
    {
      name: 'rating',
      type: 'enum',
      values: ['positive', 'negative'],
      description: 'thumbs up (positive) or down (negative)',
    },
    {
      name: 'category',
      type: 'enum',
      values: reasons,
      description: 'reason chips the user ticked; matches if any ticked chip equals the value',
    },
    {
      name: 'env',
      type: 'enum',
      dynamic: true,
      description: 'Langfuse environment of the trace (values come from the project)',
    },
    {
      name: 'created',
      type: 'date',
      description: 'when the thumb was given: 2026-09-01, 2026-09-01T10:00:00Z, today, -7d',
    },
    { name: 'comment', type: 'text', description: 'free-text comment; use CONTAINS' },
    {
      name: 'has_comment',
      type: 'boolean',
      values: ['true', 'false'],
      description: 'whether the user left a comment',
    },
    {
      name: 'user',
      type: 'string',
      dynamic: true,
      description: 'Langfuse userId of the conversation owner',
    },
    { name: 'trace', type: 'string', description: 'exact Langfuse trace id' },
    { name: 'session', type: 'string', description: 'exact Langfuse session id' },
    {
      name: 'observation',
      type: 'string',
      description: 'exact Langfuse id of the rated chat-turn',
    },
  ];
}

/** The fields to use for a context: the run's own, or the defaults when none were given. */
export function fieldsOf(context: { fields?: readonly FieldSpec[] }): readonly FieldSpec[] {
  return context.fields ?? buildFields(DEFAULT_CONVENTIONS.reasons);
}

export function findField(fields: readonly FieldSpec[], name: string): FieldSpec | undefined {
  return fields.find((field) => field.name === name.toLowerCase());
}

const OPERATORS_BY_TYPE: Record<FieldType, readonly (CmpOp | 'in')[]> = {
  enum: ['=', '!=', 'in'],
  date: ['>=', '<=', '>', '<', '=', '!='],
  text: ['contains', '=', '!='],
  string: ['=', '!=', 'in', 'contains'],
  boolean: ['='],
};

export function operatorsFor(type: FieldType): readonly (CmpOp | 'in')[] {
  return OPERATORS_BY_TYPE[type];
}

/** Environments Langfuse creates for itself: its default, SDK experiments and its own judge runs. */
const LANGFUSE_OWNED_ENVIRONMENTS = /^(default|sdk-experiment.*|langfuse-.+)$/;

/** True for an environment no application writes to, so it is left out of the suggestions (typing it still works). */
export function isLangfuseOwnedEnvironment(name: string): boolean {
  return LANGFUSE_OWNED_ENVIRONMENTS.test(name);
}
