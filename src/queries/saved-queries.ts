import { brand } from '../brand/brand.js';
import type { ConfigFile, SavedQuery } from '../config/config-schema.js';
import { savedQuerySchema, queryNameSchema } from '../config/config-schema.js';
import { parseQuery, formatQueryError } from '../dsl/parse.js';
import { buildFields } from '../dsl/fields.js';
import { QueryError } from '../dsl/types.js';

export interface QueryInput {
  where?: string;
  window?: string;
  rules: string[];
}

/** The query ready to save, or every problem in plain words. The filter is parsed now so a typo fails at save time, not in CI. */
export function buildSavedQuery(
  name: string,
  input: QueryInput,
  conventions: ConfigFile['conventions'],
): { query: SavedQuery } | { problems: string[] } {
  const problems: string[] = [];
  const nameCheck = queryNameSchema.safeParse(name);
  if (!nameCheck.success) problems.push(...nameCheck.error.issues.map((issue) => issue.message));
  const shape = savedQuerySchema.safeParse({
    where: input.where,
    window: input.window,
    rules: input.rules,
  });
  if (!shape.success) {
    problems.push(
      ...shape.error.issues.map((issue) =>
        issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
      ),
    );
  }
  if (input.where?.trim()) {
    try {
      parseQuery(input.where, { now: new Date(), fields: buildFields(conventions.reasons) });
    } catch (err) {
      if (!(err instanceof QueryError)) throw err;
      problems.push(`Invalid filter\n${formatQueryError(input.where, err)}`);
    }
  }
  return problems.length > 0 || !shape.success ? { problems } : { query: shape.data };
}

export function withQuery(config: ConfigFile, name: string, query: SavedQuery): ConfigFile {
  return { ...config, queries: { ...config.queries, [name]: query } };
}

/** Throws when the name is not saved, so a typo never looks like a success. */
export function withoutQuery(config: ConfigFile, name: string): ConfigFile {
  if (!Object.hasOwn(config.queries ?? {}, name))
    throw new Error(unknownQueryMessage(name, config));
  const { [name]: _removed, ...rest } = config.queries ?? {};
  return { ...config, queries: rest };
}

export function unknownQueryMessage(name: string, config: ConfigFile): string {
  const known = Object.keys(config.queries ?? {});
  return known.length === 0
    ? `No saved query named "${name}". There are none yet; add one with: ${brand.command} query save ${name} --rule "count >= 1"`
    : `No saved query named "${name}". Saved queries: ${known.join(', ')}`;
}
