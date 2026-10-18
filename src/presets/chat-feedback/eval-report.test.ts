import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExportRow } from './build-rows.js';
import {
  buildEvalReport,
  riskAreaFor,
  riskAreaMap,
  suiteIdFor,
  writeEvalReportFile,
  type EvalReportSource,
} from './eval-report.js';

function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    traceId: 'trace-abc',
    sessionId: 'session-1',
    rating: 'negative',
    categories: ['wrong_answer'],
    comment: 'the rate is wrong',
    environment: 'prod',
    created: Date.parse('2026-09-02T10:00:00Z'),
    userId: 'U-1',
    observationId: 'obs-1',
    turnNumber: 2,
    ratedUser: 'What is the rate?',
    ratedAssistant: 'It is 9%.',
    conversationTurns: 2,
    conversation: '[1] User: hi',
    ...overrides,
  };
}

const source: EvalReportSource = {
  cliVersion: '0.1.0',
  generatedAt: new Date('2026-10-19T08:00:00Z'),
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
  where: undefined,
  projectName: 'Chat',
};

describe('buildEvalReport', () => {
  it('should keep only thumbs-down as failed rows when positive ratings are also selected', () => {
    const report = buildEvalReport(
      [makeRow(), makeRow({ rating: 'positive', observationId: 'obs-2' })],
      source,
    );

    expect(report.rows).toHaveLength(1);
    expect(report.suites).toEqual([
      {
        id: 'live-feedback-factuality',
        name: 'Live feedback (thumbs-down): factuality',
        total: 1,
        passed: 0,
        failed: 1,
        passRate: 0,
      },
    ]);
  });

  it('should label every row production-review and proposed when it is built', () => {
    const [row] = buildEvalReport([makeRow()], source).rows;

    expect(row?.metadata.provenance).toEqual({
      source: 'production-review',
      addedBy: 'langfuse-reporter',
      reason: 'Customer gave a thumbs-down',
      sourceRef: 'langfuse:trace/trace-abc',
    });
    expect(row?.metadata.lifecycle).toEqual({ status: 'proposed', since: '2026-10-19' });
  });

  it('should map the rated turn onto the row fields when a rating has a comment and a reason', () => {
    const [row] = buildEvalReport([makeRow()], source).rows;

    expect(row).toMatchObject({
      id: 'trace-abc:obs-1',
      suite: 'live-feedback-factuality',
      kind: 'human-review',
      question: 'What is the rate?',
      input: 'What is the rate?',
      output: 'It is 9%.',
      passed: false,
      severity: 'medium',
      reason: 'the rate is wrong',
      category: 'wrong_answer',
      trace: { traceId: 'trace-abc', spanId: 'obs-1' },
    });
  });

  it('should use a fixed reason and no category when a rating has neither comment nor reasons', () => {
    const [row] = buildEvalReport([makeRow({ comment: '  ', categories: [] })], source).rows;

    expect(row?.reason).toBe('Customer gave a thumbs-down');
    expect(row).not.toHaveProperty('category');
  });

  it('should mark the report redacted and keep the user id out when it is built', () => {
    const text = JSON.stringify(buildEvalReport([makeRow({ userId: 'U-SECRET' })], source));

    expect(text).toContain('"redacted":true');
    expect(text).not.toContain('U-SECRET');
    expect(text).not.toContain('[1] User: hi');
  });

  it('should give the same row id twice only when trace and observation both match', () => {
    const report = buildEvalReport([makeRow(), makeRow({ traceId: 'trace-xyz' })], source);

    expect(report.rows.map((row) => row.id)).toEqual(['trace-abc:obs-1', 'trace-xyz:obs-1']);
  });
});

describe('writeEvalReportFile', () => {
  it('should write an owner-only eval-report/v1 file when a thumbs-down is selected', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'eval-report-'));

    const written = await writeEvalReportFile({
      outDir,
      stem: 'stem1',
      rows: [makeRow()],
      source,
    });

    expect(written.path).toBe(join(outDir, 'eval-report-stem1.json'));
    expect(JSON.parse(readFileSync(written.path ?? '', 'utf8')).schemaVersion).toBe(
      'eval-report/v1',
    );
    expect(statSync(written.path ?? '').mode & 0o777).toBe(0o600);
  });

  it('should remove an earlier file and write none when no thumbs-down is selected', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'eval-report-'));
    writeFileSync(join(outDir, 'eval-report-stem1.json'), '{}');

    const written = await writeEvalReportFile({
      outDir,
      stem: 'stem1',
      rows: [makeRow({ rating: 'positive' })],
      source,
    });

    expect(written).toEqual({ replaced: true });
  });
});

describe('riskAreaFor', () => {
  it('should map wrong_answer to factuality when it is the ticked reason', () => {
    expect(riskAreaFor(['wrong_answer'])).toBe('factuality');
  });

  it('should map harmful_content to content-safety when it is the ticked reason', () => {
    expect(riskAreaFor(['harmful_content'])).toBe('content-safety');
  });

  it('should use the first reason that has a mapping when several are ticked', () => {
    expect(riskAreaFor(['other_issue', 'off_topic', 'wrong_answer'])).toBe('relevance');
  });

  it('should return custom when no ticked reason has a mapping', () => {
    expect(riskAreaFor(['other_issue'])).toBe('custom');
  });

  it('should return custom when no reason is ticked', () => {
    expect(riskAreaFor([])).toBe('custom');
  });
});

describe('buildEvalReport risk area', () => {
  it('should write the mapped risk area on the row when a reason is ticked', () => {
    const [row] = buildEvalReport([makeRow({ categories: ['hard_to_follow'] })], source).rows;

    expect(row?.metadata.riskArea).toBe('tone-of-voice');
  });
});

describe('buildEvalReport suites per risk area', () => {
  const mixed = [
    makeRow({ observationId: 'o1', categories: ['wrong_answer'] }),
    makeRow({ observationId: 'o2', categories: ['wrong_answer'] }),
    makeRow({ observationId: 'o3', categories: ['off_topic'] }),
    makeRow({ observationId: 'o4', categories: [] }),
  ];

  it('should make one suite per risk area with the count of its thumbs-down when areas differ', () => {
    const report = buildEvalReport(mixed, source);

    expect(report.suites.map((suite) => [suite.id, suite.total, suite.failed])).toEqual([
      ['live-feedback-custom', 1, 1],
      ['live-feedback-factuality', 2, 2],
      ['live-feedback-relevance', 1, 1],
    ]);
  });

  it('should declare each suite risk area in a manifest so the dashboard can group by it', () => {
    const report = buildEvalReport(mixed, source);

    expect(report.suiteManifests.map((manifest) => [manifest.name, manifest.riskArea])).toEqual([
      ['live-feedback-custom', 'custom'],
      ['live-feedback-factuality', 'factuality'],
      ['live-feedback-relevance', 'relevance'],
    ]);
  });

  it('should put every row in the suite of its own risk area when the report is built', () => {
    const report = buildEvalReport(mixed, source);

    expect(report.rows.map((row) => [row.id, row.suite])).toEqual([
      ['trace-abc:o1', 'live-feedback-factuality'],
      ['trace-abc:o2', 'live-feedback-factuality'],
      ['trace-abc:o3', 'live-feedback-relevance'],
      ['trace-abc:o4', 'live-feedback-custom'],
    ]);
  });

  it('should make no suite and no manifest when there is no thumbs-down', () => {
    const report = buildEvalReport([makeRow({ rating: 'positive' })], source);

    expect([report.suites, report.suiteManifests, report.rows]).toEqual([[], [], []]);
  });

  it('should name the suite from its risk area when asked', () => {
    expect(suiteIdFor('tone-of-voice')).toBe('live-feedback-tone-of-voice');
  });
});

describe('a configured risk area map', () => {
  const custom = ['wrong_answer=compliance', 'other_issue=pii'];

  it('should use the configured area for a reason instead of the built-in one', () => {
    expect(riskAreaFor(['wrong_answer'], riskAreaMap(custom))).toBe('compliance');
  });

  it('should keep the built-in area for a reason the configured map leaves out', () => {
    expect(riskAreaFor(['off_topic'], riskAreaMap(custom))).toBe('relevance');
  });

  it('should turn a built-in pair off when the configured pair says custom', () => {
    expect(riskAreaFor(['off_topic'], riskAreaMap(['off_topic=custom']))).toBe('custom');
  });

  it('should fall back to custom for a reason no map mentions', () => {
    expect(riskAreaFor(['unheard_of'], riskAreaMap(custom))).toBe('custom');
  });

  it('should group the report by the configured areas when the source carries a map', () => {
    const report = buildEvalReport(
      [
        makeRow({ observationId: 'o1', categories: ['wrong_answer'] }),
        makeRow({ observationId: 'o2', categories: ['other_issue'] }),
      ],
      { ...source, riskAreas: custom },
    );

    expect(report.suiteManifests.map((manifest) => manifest.riskArea)).toEqual([
      'compliance',
      'pii',
    ]);
  });
});

describe('the window total in the report', () => {
  it('should record every rating in the window next to the selected count when the export was filtered', () => {
    const report = buildEvalReport([makeRow()], {
      ...source,
      where: 'category = wrong_answer',
      ratingsInWindow: 120,
    });

    expect(report.run.configSnapshot.values).toMatchObject({
      ratingsTotal: 1,
      ratingsInWindow: 120,
    });
  });

  it('should record the selected count as the window count when no filter was used', () => {
    const report = buildEvalReport([makeRow(), makeRow({ observationId: 'o2' })], source);

    expect(report.run.configSnapshot.values).toMatchObject({ ratingsTotal: 2, ratingsInWindow: 2 });
  });
});
