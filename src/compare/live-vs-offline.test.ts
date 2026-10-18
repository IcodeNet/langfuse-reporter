import { describe, expect, it } from 'vitest';
import {
  compareLiveWithOffline,
  parseEvalReport,
  type EvalReportInput,
} from './live-vs-offline.js';

function offlineReport(): EvalReportInput {
  return {
    schemaVersion: 'eval-report/v1',
    run: {},
    suites: [
      { id: 'quality-a', total: 10, passed: 8 },
      { id: 'quality-b', total: 10, passed: 10 },
      { id: 'no-area', total: 5, passed: 0 },
    ],
    suiteManifests: [
      { name: 'quality-a', riskArea: 'response-quality' },
      { name: 'quality-b', riskArea: 'response-quality' },
    ],
    rows: [],
  };
}

function liveReport(areas: string[], ratingsTotal?: number): EvalReportInput {
  return {
    schemaVersion: 'eval-report/v1',
    run: {
      configSnapshot: { values: ratingsTotal === undefined ? {} : { ratingsTotal } },
    },
    suites: [],
    rows: areas.map((riskArea) => ({ metadata: { riskArea } })),
  };
}

describe('compareLiveWithOffline', () => {
  it('should add the failed rows of every suite in one risk area when several suites share it', () => {
    const result = compareLiveWithOffline(offlineReport(), liveReport([], 100));

    expect(result.areas).toEqual([
      {
        riskArea: 'response-quality',
        offlineTotal: 20,
        offlineFailed: 2,
        offlineFailRate: 0.1,
        liveThumbsDown: 0,
        liveThumbsDownShare: 0,
      },
    ]);
  });

  it('should leave out a suite when it declares no risk area', () => {
    const result = compareLiveWithOffline(offlineReport(), liveReport([], 100));

    expect(result.areas.map((area) => area.riskArea)).toEqual(['response-quality']);
  });

  it('should share thumbs-down by all live ratings when the live report holds the count', () => {
    const result = compareLiveWithOffline(
      offlineReport(),
      liveReport(['response-quality', 'response-quality', 'factuality'], 50),
    );

    expect(result.areas.map((a) => [a.riskArea, a.liveThumbsDown, a.liveThumbsDownShare])).toEqual([
      ['factuality', 1, 0.02],
      ['response-quality', 2, 0.04],
    ]);
  });

  it('should show a live-only area with no offline rate when no offline suite covers it', () => {
    const result = compareLiveWithOffline(offlineReport(), liveReport(['factuality'], 10));

    expect(result.areas[0]).toMatchObject({
      riskArea: 'factuality',
      offlineTotal: 0,
      offlineFailRate: undefined,
    });
  });

  it('should leave the share unknown when the live report has no rating count', () => {
    const result = compareLiveWithOffline(offlineReport(), liveReport(['factuality']));

    expect(result.liveRatingsTotal).toBeUndefined();
    expect(result.areas[0]?.liveThumbsDownShare).toBeUndefined();
  });
});

describe('parseEvalReport', () => {
  it('should reject a file when it is not an eval-report/v1 report', () => {
    expect(() => parseEvalReport('{"schemaVersion":"other"}')).toThrow();
  });
});

describe('a live file made with a filter', () => {
  const liveWith = (values: Record<string, unknown>, areas: string[]): EvalReportInput => ({
    schemaVersion: 'eval-report/v1',
    run: { configSnapshot: { values } },
    suites: [],
    rows: areas.map((riskArea) => ({ metadata: { riskArea } })),
  });

  it('should divide by every rating in the window when the file records it', () => {
    const result = compareLiveWithOffline(
      offlineReport(),
      liveWith(
        { ratingsTotal: 13, ratingsInWindow: 120, filter: 'category = wrong_answer' },
        new Array<string>(13).fill('factuality'),
      ),
    );

    expect(result.areas.find((a) => a.riskArea === 'factuality')?.liveThumbsDownShare).toBeCloseTo(
      13 / 120,
      10,
    );
  });

  it('should say the file was filtered and that the window total is known when both are true', () => {
    const result = compareLiveWithOffline(
      offlineReport(),
      liveWith({ ratingsTotal: 13, ratingsInWindow: 120, filter: 'rating = negative' }, [
        'factuality',
      ]),
    );

    expect([result.liveFiltered, result.windowTotalKnown]).toEqual([true, true]);
  });

  it('should say the total is unknown when an older file has a filter but no window total', () => {
    const result = compareLiveWithOffline(
      offlineReport(),
      liveWith({ ratingsTotal: 13, filter: 'rating = negative' }, ['factuality']),
    );

    expect([result.liveFiltered, result.windowTotalKnown]).toEqual([true, false]);
  });

  it('should not call a file filtered when its filter is none', () => {
    const result = compareLiveWithOffline(
      offlineReport(),
      liveWith({ ratingsTotal: 120, ratingsInWindow: 120, filter: 'none' }, ['factuality']),
    );

    expect(result.liveFiltered).toBe(false);
  });
});
