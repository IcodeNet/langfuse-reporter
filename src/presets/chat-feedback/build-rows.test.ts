import { describe, expect, it } from 'vitest';
import type { LangfuseScore, LangfuseTurn } from '../../langfuse/langfuse-client.js';
import { DEFAULT_CONVENTIONS } from '../../config/config-schema.js';
import { buildRows, buildRowsFromScores } from './build-rows.js';

const NAMES = DEFAULT_CONVENTIONS;

function makeScore(overrides: Partial<LangfuseScore> = {}): LangfuseScore {
  return {
    id: 't1:turn-1:feedback_helpful',
    name: 'feedback_helpful',
    value: true,
    comment: null,
    timestamp: '2026-09-10T10:00:30.000Z',
    updatedAt: '2026-09-10T10:00:32.000Z',
    environment: 'uat-like',
    subject: { kind: 'observation', id: 'turn-1', traceId: 't1' },
    ...overrides,
  };
}

function makeTurn(overrides: Partial<LangfuseTurn> = {}): LangfuseTurn {
  return {
    id: 'turn-1',
    traceId: 't1',
    sessionId: 's1',
    userId: 'U-1',
    environment: 'uat-like',
    startTime: '2026-09-10T10:00:00.000Z',
    input: 'first question',
    output: 'first answer',
    ...overrides,
  };
}

const TURN_TWO = makeTurn({
  id: 'turn-2',
  startTime: '2026-09-10T10:01:00.000Z',
  input: 'second question',
  output: 'second answer',
});

function conversationOf(...turns: LangfuseTurn[]): ReadonlyMap<string, readonly LangfuseTurn[]> {
  return new Map([['s1', turns]]);
}

describe('buildRows', () => {
  it('should show the question and answer of the turn the score sits on when rating a later turn', () => {
    const { rows } = buildRows({
      names: NAMES,
      scores: [makeScore({ subject: { kind: 'observation', id: 'turn-2', traceId: 't1' } })],
      conversations: conversationOf(TURN_TWO, makeTurn()),
    });

    expect(rows[0]).toMatchObject({
      observationId: 'turn-2',
      ratedUser: 'second question',
      ratedAssistant: 'second answer',
      turnNumber: 2,
    });
  });

  it('should number turns oldest first when the conversation arrives out of order', () => {
    const { rows } = buildRows({
      names: NAMES,
      scores: [makeScore()],
      conversations: conversationOf(TURN_TWO, makeTurn()),
    });

    expect(rows[0]).toMatchObject({ turnNumber: 1, conversationTurns: 2 });
  });

  it('should collect only the ticked reasons that sit on the same turn when siblings exist', () => {
    const { rows } = buildRows({
      names: NAMES,
      scores: [
        makeScore({ value: false }),
        makeScore({ name: 'feedback_other_issue', value: true }),
        makeScore({ name: 'feedback_well_explained', value: false }),
        makeScore({
          name: 'feedback_wrong_answer',
          value: true,
          subject: { kind: 'observation', id: 'turn-2', traceId: 't1' },
        }),
      ],
      conversations: conversationOf(makeTurn(), TURN_TWO),
    });

    expect(rows[0]).toMatchObject({ rating: 'negative', categories: ['other_issue'] });
  });

  it('should make one row per rated turn when two turns of a conversation were rated', () => {
    const { rows } = buildRows({
      names: NAMES,
      scores: [
        makeScore(),
        makeScore({ subject: { kind: 'observation', id: 'turn-2', traceId: 't1' }, value: false }),
      ],
      conversations: conversationOf(makeTurn(), TURN_TWO),
    });

    expect(rows.map((row) => [row.observationId, row.rating])).toEqual([
      ['turn-1', 'positive'],
      ['turn-2', 'negative'],
    ]);
  });

  it('should mark only the rated turn in the conversation text when printing it', () => {
    const { rows } = buildRows({
      names: NAMES,
      scores: [makeScore()],
      conversations: conversationOf(makeTurn(), TURN_TWO),
    });

    expect(rows[0]?.conversation).toBe(
      '[1] ◀ RATED\nUser: first question\nAssistant: first answer\n\n[2]\nUser: second question\nAssistant: second answer',
    );
  });

  it('should take the trace, session and user from the rated turn when building the row', () => {
    const { rows } = buildRows({
      names: NAMES,
      scores: [makeScore()],
      conversations: conversationOf(makeTurn()),
    });

    expect(rows[0]).toMatchObject({ traceId: 't1', sessionId: 's1', userId: 'U-1' });
  });

  it('should count a rating whose turn Langfuse did not return when building rows', () => {
    const result = buildRows({ names: NAMES, scores: [makeScore()], conversations: new Map() });

    expect(result).toEqual({ rows: [], missingTurns: 1 });
  });

  it('should ignore trace-level scores when building rows', () => {
    const { rows } = buildRows({
      names: NAMES,
      scores: [makeScore({ subject: { kind: 'trace', id: 't1' } })],
      conversations: conversationOf(makeTurn()),
    });

    expect(rows).toEqual([]);
  });

  it('should ignore reason scores when the same turn has no feedback_helpful score', () => {
    const { rows } = buildRows({
      names: NAMES,
      scores: [makeScore({ name: 'feedback_other_issue', value: true })],
      conversations: conversationOf(makeTurn()),
    });

    expect(rows).toEqual([]);
  });

  it('should sort rows by when the thumb was given when several turns were rated', () => {
    const { rows } = buildRows({
      names: NAMES,
      scores: [
        makeScore({
          subject: { kind: 'observation', id: 'turn-2', traceId: 't1' },
          timestamp: '2026-09-10T09:00:00.000Z',
        }),
        makeScore(),
      ],
      conversations: conversationOf(makeTurn(), TURN_TWO),
    });

    expect(rows.map((row) => row.observationId)).toEqual(['turn-2', 'turn-1']);
  });

  it('should ignore a score when it has no subject', () => {
    const orphan: LangfuseScore = { ...makeScore(), subject: undefined };

    const { rows } = buildRows({
      names: NAMES,
      scores: [orphan, makeScore()],
      conversations: conversationOf(makeTurn()),
    });

    expect(rows).toHaveLength(1);
  });

  it('should take the environment from the turn when the score names another', () => {
    const { rows } = buildRows({
      names: NAMES,
      scores: [makeScore({ environment: 'score-env' })],
      conversations: conversationOf(makeTurn({ environment: 'turn-env' })),
    });

    expect(rows[0]?.environment).toBe('turn-env');
  });
});

describe('a turn rated twice', () => {
  const rated = (id: string, value: boolean, timestamp: string): LangfuseScore => ({
    id,
    name: 'feedback_helpful',
    value,
    comment: null,
    timestamp,
    updatedAt: timestamp,
    environment: 'x',
    subject: { kind: 'observation', id: 'o1', traceId: 't1' },
  });
  const earlierYes = rated('a', true, '2026-10-14T10:01:00.000Z');
  const laterNo = rated('b', false, '2026-10-14T10:05:00.000Z');
  const turn = {
    id: 'o1',
    traceId: 't1',
    sessionId: 's1',
    userId: 'u',
    environment: 'x',
    startTime: '2026-10-14T10:00:00.000Z',
    input: 'q',
    output: 'a',
  } as LangfuseTurn;
  const names = {
    ratingScore: 'feedback_helpful',
    reasonScorePrefix: 'why.',
    yesValues: ['true', '1'],
    reasons: [],
  };

  it.each([
    ['earlier first', [earlierYes, laterNo]],
    ['later first', [laterNo, earlierYes]],
  ])('should keep the later thumb when the scores arrive %s', (_label, scores) => {
    const { rows } = buildRows({ scores, conversations: new Map([['s1', [turn]]]), names });

    expect(rows.map((row) => row.rating)).toEqual(['negative']);
  });

  it('should keep the later thumb when the rows are counted from the scores alone', () => {
    const rows = buildRowsFromScores({ scores: [laterNo, earlierYes], names });

    expect(rows.map((row) => row.rating)).toEqual(['negative']);
  });

  describe('with ticked reasons', () => {
    const reason = (id: string, name: string, timestamp: string): LangfuseScore => ({
      id,
      name,
      value: true,
      comment: null,
      timestamp,
      updatedAt: timestamp,
      environment: 'x',
      subject: { kind: 'observation', id: 'o1', traceId: 't1' },
    });
    const oldDownWithReason = rated('down', false, '2026-10-14T10:01:00.000Z');
    const oldReason = reason('r-old', 'why.wrong_answer', '2026-10-14T10:01:00.000Z');
    const laterUp = rated('up', true, '2026-10-14T10:05:00.000Z');
    const laterDown = rated('down2', false, '2026-10-14T10:09:00.000Z');
    const laterReason = reason('r-new', 'why.off_topic', '2026-10-14T10:09:00.000Z');

    it('should drop the reasons of the earlier thumb when the user changed to a thumbs up', () => {
      const { rows } = buildRows({
        scores: [oldReason, oldDownWithReason, laterUp],
        conversations: new Map([['s1', [turn]]]),
        names,
      });

      expect(rows.map((row) => [row.rating, row.categories])).toEqual([['positive', []]]);
    });

    it('should keep only the reasons of the latest thumb when the user changed their mind twice', () => {
      const { rows } = buildRows({
        scores: [oldReason, oldDownWithReason, laterUp, laterDown, laterReason],
        conversations: new Map([['s1', [turn]]]),
        names,
      });

      expect(rows.map((row) => [row.rating, row.categories])).toEqual([
        ['negative', ['off_topic']],
      ]);
    });

    it('should keep the reasons when the turn was rated only once', () => {
      const { rows } = buildRows({
        scores: [oldDownWithReason, oldReason],
        conversations: new Map([['s1', [turn]]]),
        names,
      });

      expect(rows.map((row) => row.categories)).toEqual([['wrong_answer']]);
    });

    it('should keep a reason written a moment after its thumb when the turn was rated once', () => {
      const lateReason = reason('r-late', 'why.wrong_answer', '2026-10-14T10:01:20.000Z');
      const { rows } = buildRows({
        scores: [oldDownWithReason, lateReason],
        conversations: new Map([['s1', [turn]]]),
        names,
      });

      expect(rows.map((row) => row.categories)).toEqual([['wrong_answer']]);
    });

    it('should drop the earlier thumb reasons when counting from the scores alone', () => {
      const rows = buildRowsFromScores({ scores: [oldReason, oldDownWithReason, laterUp], names });

      expect(rows.map((row) => [row.rating, row.categories])).toEqual([['positive', []]]);
    });
  });
});
