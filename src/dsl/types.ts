export type CmpOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains';

export type FieldType = 'enum' | 'date' | 'text' | 'string' | 'boolean';

export type Scalar = string | number | boolean;

export type Expr =
  | { kind: 'and' | 'or'; left: Expr; right: Expr }
  | { kind: 'not'; operand: Expr }
  | { kind: 'cmp'; field: string; op: CmpOp; value: Scalar }
  | { kind: 'in'; field: string; values: Scalar[] };

export interface FeedbackRow {
  traceId: string;
  sessionId: string;
  rating: 'positive' | 'negative';
  categories: string[];
  comment: string;
  environment: string;
  /** Epoch milliseconds of the thumb. */
  created: number;
  userId: string;
  /** The chat-turn the thumb was given on. */
  observationId: string;
}

export interface FieldSpec {
  name: string;
  type: FieldType;
  description: string;
  /** Fixed value set. Fields with `dynamic: true` get theirs from the live project instead. */
  values?: readonly string[];
  dynamic?: boolean;
}

export interface ParseContext {
  now: Date;
  /** The filter fields for this run; the reasons in the config feed `category`. */
  fields?: readonly FieldSpec[];
  /** Live value sets for dynamic fields (e.g. environment, user), when already fetched. */
  dynamicValues?: Readonly<Record<string, readonly string[]>>;
  /** When present for a field, these are the values offered as suggestions; every value in `dynamicValues` is still accepted. */
  suggestedValues?: Readonly<Record<string, readonly string[]>>;
}

export class QueryError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = 'QueryError';
  }
}
