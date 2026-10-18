import { describe, expect, it } from 'vitest';
import { createMasker } from '../../output/mask.js';
import type { ExportRow } from './build-rows.js';
import { maskRows } from './mask-rows.js';

function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    traceId: 'trace-abc',
    sessionId: 'session-1',
    rating: 'negative',
    categories: ['other_issue'],
    comment: 'mail me at a@b.com',
    environment: 'uat-like',
    created: Date.parse('2026-09-02T10:00:00Z'),
    userId: 'U-1',
    observationId: 'obs-1',
    turnNumber: 1,
    ratedUser: 'my card is 4111 1111 1111 1111',
    ratedAssistant: 'call 07700 900123',
    conversationTurns: 1,
    conversation: '[1] User: a@b.com',
    ...overrides,
  };
}

describe('maskRows', () => {
  it('should mask the user id and every free-text field when a row is masked', () => {
    const [row] = maskRows([makeRow()], createMasker('salt'));

    expect({
      comment: row?.comment,
      ratedUser: row?.ratedUser,
      ratedAssistant: row?.ratedAssistant,
      conversation: row?.conversation,
      userId: row?.userId.startsWith('user-'),
    }).toEqual({
      comment: 'mail me at [email]',
      ratedUser: 'my card is [card]',
      ratedAssistant: 'call [phone]',
      conversation: '[1] User: [email]',
      userId: true,
    });
  });

  it('should keep the trace link fields when a row is masked', () => {
    const [row] = maskRows([makeRow()], createMasker('salt'));

    expect([row?.traceId, row?.observationId]).toEqual(['trace-abc', 'obs-1']);
  });

  it('should leave the original rows unchanged when they are masked', () => {
    const original = makeRow();

    maskRows([original], createMasker('salt'));

    expect(original.userId).toBe('U-1');
  });
});
