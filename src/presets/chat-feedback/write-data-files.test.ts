import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExportRow } from './build-rows.js';
import { writeSplitDataFiles } from './write-data-files.js';

function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    traceId: 'trace-abc',
    sessionId: 'session-1',
    rating: 'negative',
    categories: ['other_issue'],
    comment: 'not helpful',
    environment: 'uat-like',
    created: Date.parse('2026-09-02T10:00:00Z'),
    userId: 'U-1',
    observationId: 'obs-1',
    turnNumber: 1,
    ratedUser: 'hello',
    ratedAssistant: 'hi',
    conversationTurns: 1,
    conversation: '[1] User: hello',
    ...overrides,
  };
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'data-files-'));
}

describe('writeSplitDataFiles', () => {
  it('should write one positive and one negative JSON file when both sides have ratings', async () => {
    const dir = makeDir();

    await writeSplitDataFiles({
      outDir: dir,
      stem: 'both',
      format: 'json',
      rows: [makeRow(), makeRow({ rating: 'positive' })],
    });

    expect(readdirSync(dir).sort()).toEqual([
      'feedback-negative-both.json',
      'feedback-positive-both.json',
    ]);
  });

  it('should write the CSV header and one line per rating when the format is csv', async () => {
    const dir = makeDir();

    const paths = await writeSplitDataFiles({
      outDir: dir,
      stem: 'c',
      format: 'csv',
      rows: [makeRow()],
    });

    expect(readFileSync(paths.negative!, 'utf8').split('\n')[0]).toBe(
      'created,rating,reasons,comment,environment,traceId,sessionId,observationId,turnNumber,question,answer',
    );
  });

  it('should keep the user id out of the file when rows are written', async () => {
    const dir = makeDir();

    const paths = await writeSplitDataFiles({
      outDir: dir,
      stem: 'u',
      format: 'json',
      rows: [makeRow({ userId: 'secret-user-id' })],
    });

    expect(readFileSync(paths.negative!, 'utf8')).not.toContain('secret-user-id');
  });

  it('should write only the negative file when there are no positive ratings', async () => {
    const dir = makeDir();

    const paths = await writeSplitDataFiles({
      outDir: dir,
      stem: 'n',
      format: 'json',
      rows: [makeRow()],
    });

    expect(paths.positive).toBeUndefined();
    expect(readdirSync(dir)).toEqual(['feedback-negative-n.json']);
  });

  it('should make each file readable by its owner only when it is written', async () => {
    const dir = makeDir();

    const paths = await writeSplitDataFiles({
      outDir: dir,
      stem: 'p',
      format: 'csv',
      rows: [makeRow()],
    });

    expect(statSync(paths.negative!).mode & 0o777).toBe(0o600);
  });

  it('should remove a stale file and report a replacement when that side is now empty', async () => {
    const dir = makeDir();
    await writeSplitDataFiles({ outDir: dir, stem: 's', format: 'json', rows: [makeRow()] });

    const second = await writeSplitDataFiles({
      outDir: dir,
      stem: 's',
      format: 'json',
      rows: [makeRow({ rating: 'positive' })],
    });

    expect(second.replaced).toBe(true);
    expect(readdirSync(dir)).toEqual(['feedback-positive-s.json']);
  });

  it('should keep an Excel file of the same name when JSON files are written', async () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'feedback-negative-x.xlsx'), 'excel');

    await writeSplitDataFiles({ outDir: dir, stem: 'x', format: 'json', rows: [makeRow()] });

    expect(readdirSync(dir).sort()).toEqual([
      'feedback-negative-x.json',
      'feedback-negative-x.xlsx',
    ]);
  });

  it('should refuse to write when the name could escape the folder', async () => {
    const dir = makeDir();

    const attempt = writeSplitDataFiles({
      outDir: dir,
      stem: '../../etc/x',
      format: 'json',
      rows: [makeRow()],
    });

    await expect(attempt).rejects.toThrow('not a safe file name');
  });
});
