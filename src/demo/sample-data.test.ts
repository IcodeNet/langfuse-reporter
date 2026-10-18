import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVENTIONS } from '../config/config-schema.js';
import { buildRows } from '../presets/chat-feedback/build-rows.js';
import { buildSampleData } from './sample-data.js';

const NOW = new Date('2026-10-16T12:00:00Z');
const DATA = buildSampleData({ now: NOW, conventions: DEFAULT_CONVENTIONS });

describe('buildSampleData', () => {
  it('should give the same data when it is built twice', () => {
    expect(buildSampleData({ now: NOW, conventions: DEFAULT_CONVENTIONS })).toEqual(DATA);
  });

  it('should make 60 rated turns with a rating score each when it is built', () => {
    const ratings = DATA.scores.filter(
      (score) =>
        score.name === DEFAULT_CONVENTIONS.ratingScore && score.subject?.kind === 'observation',
    );

    expect(ratings).toHaveLength(60);
  });

  it('should add ratings on the whole trace when it is built, so the ignored case is shown', () => {
    const onTrace = DATA.scores.filter((score) => score.subject?.kind === 'trace');

    expect(onTrace).toHaveLength(3);
  });

  it('should keep every rating inside last month when it is built', () => {
    const outside = DATA.scores.filter(
      (score) =>
        score.timestamp < '2026-09-01T00:00:00.000Z' ||
        score.timestamp >= '2026-10-01T00:00:00.000Z',
    );

    expect(outside).toEqual([]);
  });

  it('should join every rating to its turn when rows are built from it', () => {
    const conversations = new Map<string, typeof DATA.turns>();
    for (const turn of DATA.turns) {
      const key = turn.sessionId ?? turn.id;
      conversations.set(key, [...(conversations.get(key) ?? []), turn]);
    }

    const built = buildRows({
      scores: DATA.scores.filter((score) => score.subject?.kind === 'observation'),
      conversations,
      names: DEFAULT_CONVENTIONS,
    });

    expect({ rows: built.rows.length, missing: built.missingTurns }).toEqual({
      rows: 60,
      missing: 0,
    });
  });

  it('should include both thumbs up and thumbs down when rows are built', () => {
    const ratings = DATA.scores.filter((score) => score.name === DEFAULT_CONVENTIONS.ratingScore);
    const values = new Set(ratings.map((score) => String(score.value)));

    expect([...values].sort()).toEqual(['false', 'true']);
  });

  it('should hold made-up personal details only on reserved example addresses when it is built', () => {
    const text = JSON.stringify(DATA);
    const emails = text.match(/[A-Za-z0-9._-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*/g) ?? [];

    expect(new Set(emails.map((email) => email.split('@')[1]))).toEqual(new Set(['example.com']));
  });

  it('should use only reason names from the config when it is built', () => {
    const reasonScores = DATA.scores.filter(
      (score) =>
        score.name !== DEFAULT_CONVENTIONS.ratingScore && score.subject?.kind === 'observation',
    );
    const allowed = DEFAULT_CONVENTIONS.reasons.map(
      (reason) => `${DEFAULT_CONVENTIONS.reasonScorePrefix}${reason}`,
    );

    expect(reasonScores.filter((score) => !allowed.includes(score.name))).toEqual([]);
  });

  it('should follow the conventions given when other names are configured', () => {
    const data = buildSampleData({
      now: NOW,
      conventions: { ...DEFAULT_CONVENTIONS, ratingScore: 'thumb', turnName: 'answer-turn' },
    });

    expect([data.turnName, data.scores.some((score) => score.name === 'thumb')]).toEqual([
      'answer-turn',
      true,
    ]);
  });
});
