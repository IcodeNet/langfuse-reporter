import { operatorsFor } from './fields.js';
import type { FieldSpec } from './types.js';

/** The label and description of every filter field, with its operators and valid values. */
export function describeFields(fields: readonly FieldSpec[]): Array<readonly [string, string]> {
  return fields.map((field) => {
    const values = field.values ? `  values: ${field.values.join(', ')}` : '';
    return [
      `${field.name} (${field.type}; ${operatorsFor(field.type).join(' ')})`,
      `${field.description}${values}`,
    ] as const;
  });
}
