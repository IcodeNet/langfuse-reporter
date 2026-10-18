import { describe, expect, it } from 'vitest';
import {
  explainEmpty,
  lastWeekCommand,
  type EmptyRequest,
  type LoadNotes,
} from './explain-empty.js';
import type { ResolvedConfig } from '../config/resolve-config.js';

const NOW = new Date('2026-10-14T10:00:00.000Z');
const RESOLVED = {
  profileName: 'prod',
  from: '2026-09-14T00:00:00.000Z',
  to: '2026-10-14T00:00:00.000Z',
} as Pick<ResolvedConfig, 'profileName' | 'from' | 'to'> as ResolvedConfig;

function ask(rowCount: number, notes: LoadNotes, interactive = true): EmptyRequest {
  return { rowCount, notes, resolved: RESOLVED, now: NOW, interactive };
}

describe('explainEmpty', () => {
  it('should say nothing when rows were found', () => {
    expect(explainEmpty(ask(3, { traceLevelRatings: 0, missingTurns: 0 }))).toEqual([]);
  });

  it('should suggest a pasteable last-week window and name the profile when nothing was found at all', () => {
    const lines = explainEmpty(ask(0, { traceLevelRatings: 0, missingTurns: 0 }));

    expect(lines.join('\n')).toContain('profile "prod"');
    expect(lines.join('\n')).toContain('window 2026-10-07 2026-10-15');
  });

  it('should explain that ratings sit on the trace when only trace-level ratings exist', () => {
    const lines = explainEmpty(ask(0, { traceLevelRatings: 22, missingTurns: 0 }));

    expect([lines.at(0)?.startsWith('No ratings on a chat turn'), lines[1]]).toEqual([
      true,
      expect.stringContaining('22 rating(s) were found, but they sit on the whole trace'),
    ]);
  });

  it('should give a next step when ratings point at answers Langfuse no longer returns', () => {
    const lines = explainEmpty(ask(0, { traceLevelRatings: 0, missingTurns: 4 }));

    expect(lines[1]).toContain(
      '4 rating(s) point at an answer Langfuse no longer returns. Try a narrower window',
    );
  });
});

describe('explainEmpty outside the session', () => {
  it('should suggest --from and --to flags when the run is one-shot', () => {
    const lines = explainEmpty(ask(0, { traceLevelRatings: 0, missingTurns: 0 }, false));

    expect(lines.join('\n')).toContain('Try: --from 2026-10-07 --to 2026-10-15');
  });
});

describe('lastWeekCommand', () => {
  it('should end tomorrow when the suggested window must include today', () => {
    expect(lastWeekCommand(NOW)).toBe('window 2026-10-07 2026-10-15');
  });
});
