import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_RISK_AREAS } from '../../config/config-schema.js';
import { ensureOutDir } from '../../output/check-out-dir.js';
import { writePrivateText } from '../../output/private-file.js';
import { stripControlCharacters } from '../../ui/untrusted-text.js';
import type { ExportRow } from './build-rows.js';
import { assertSafeStem } from './export-paths.js';

export const LIVE_FEEDBACK_SUITE = 'live-feedback';

/** One suite per risk area, because the dashboard reads a risk area from a suite, not from a row. */
export const suiteIdFor = (riskArea: string): string => `${LIVE_FEEDBACK_SUITE}-${riskArea}`;

/**
 * Turns the configured `reason=area` entries into a lookup. The built-in pairs stay unless a configured
 * pair names the same reason, so setting one pair never drops the others. `reason=custom` turns a
 * built-in pair off.
 */
export function riskAreaMap(entries: readonly string[]): ReadonlyMap<string, string> {
  const merged = new Map<string, string>();
  for (const entry of [...DEFAULT_RISK_AREAS, ...entries]) {
    const [reason, area] = entry.split('=') as [string, string];
    if (area === 'custom') merged.delete(reason);
    else merged.set(reason, area);
  }
  return merged;
}

const DEFAULT_MAP = riskAreaMap([]);

/** The risk area of the first ticked reason that has a mapping, else `custom`. */
export function riskAreaFor(
  reasons: readonly string[],
  map: ReadonlyMap<string, string> = DEFAULT_MAP,
): string {
  const mapped = reasons.map((reason) => map.get(reason)).find(Boolean);
  return mapped ?? 'custom';
}

export interface EvalReportSource {
  /** Tool version, written into the report so a reader knows what made it. */
  cliVersion: string;
  generatedAt: Date;
  /** Window start and end as ISO timestamps; the end is not included. */
  from: string;
  to: string;
  /** The filter as typed, or undefined for none. */
  where: string | undefined;
  projectName: string;
  /** Which risk area each reason belongs to, from the config; the built-in map when omitted. */
  riskAreas?: readonly string[];
  /** Every rating in the window, before any filter, so a share of all ratings stays right when the export was filtered. */
  ratingsInWindow?: number;
}

interface EvalRow {
  id: string;
  suite: string;
  kind: 'human-review';
  name: string;
  question: string;
  input: string;
  output: string;
  passed: false;
  severity: 'medium';
  reason: string;
  category?: string;
  trace: { traceId: string; spanId: string };
  metadata: {
    provenance: { source: 'production-review'; addedBy: string; reason: string; sourceRef: string };
    lifecycle: { status: 'proposed'; since: string };
    reasons: string[];
    riskArea: string;
    ratedAt: string;
    environment: string;
    sessionId: string;
    turnNumber: number;
  };
}

/** What the dashboard reads: a run, one suite summary, and one row per thumbs-down. */
export interface EvalReport {
  schemaVersion: 'eval-report/v1';
  run: {
    id: string;
    generatedAt: string;
    project: string;
    kind: 'production-feedback';
    configSnapshot: {
      redacted: true;
      source: 'langfuse-reporter';
      values: Record<string, string | number>;
    };
  };
  suites: Array<{
    id: string;
    name: string;
    total: number;
    passed: 0;
    failed: number;
    passRate: 0;
  }>;
  suiteManifests: Array<{
    name: string;
    target: 'conversation';
    datasetSource: 'production-sample';
    datasetVersion: string;
    riskArea: string;
    graders: ['custom'];
    gate: { mode: 'report-only'; thresholds: Record<string, never> };
    description: string;
  }>;
  rows: EvalRow[];
}

const FALLBACK_REASON = 'Customer gave a thumbs-down';

/** A rating carries no severity, so every row gets this fixed default; a reviewer raises or lowers it. */
const DEFAULT_SEVERITY = 'medium';

function toEvalRow(
  row: ExportRow,
  source: EvalReportSource,
  map: ReadonlyMap<string, string>,
): EvalRow {
  const comment = stripControlCharacters(row.comment).trim();
  const reasons = row.categories.map((reason) => stripControlCharacters(reason));
  const question = stripControlCharacters(row.ratedUser);
  const [firstReason] = reasons;
  return {
    id: `${row.traceId}:${row.observationId}`,
    suite: suiteIdFor(riskAreaFor(reasons, map)),
    kind: 'human-review',
    name: `Thumbs-down, turn ${row.turnNumber}`,
    question,
    input: question,
    output: stripControlCharacters(row.ratedAssistant),
    passed: false,
    severity: DEFAULT_SEVERITY,
    reason: comment === '' ? FALLBACK_REASON : comment,
    ...(firstReason === undefined ? {} : { category: firstReason }),
    trace: { traceId: row.traceId, spanId: row.observationId },
    metadata: {
      provenance: {
        source: 'production-review',
        addedBy: 'langfuse-reporter',
        reason: FALLBACK_REASON,
        sourceRef: `langfuse:trace/${row.traceId}`,
      },
      lifecycle: { status: 'proposed', since: source.generatedAt.toISOString().slice(0, 10) },
      reasons,
      riskArea: riskAreaFor(reasons, map),
      ratedAt: new Date(row.created).toISOString(),
      environment: stripControlCharacters(row.environment),
      sessionId: row.sessionId,
      turnNumber: row.turnNumber,
    },
  };
}

/**
 * Only thumbs-down become rows: each is a real failure, so a regression case. The suite is
 * all-failed by construction, so its pass rate says nothing about quality. Positives are only counted, in
 * the run's config values, so a later comparison can turn the thumbs-down into a share of all ratings.
 */
export function buildEvalReport(rows: readonly ExportRow[], source: EvalReportSource): EvalReport {
  const map = source.riskAreas ? riskAreaMap(source.riskAreas) : DEFAULT_MAP;
  const negative = rows.filter((row) => row.rating === 'negative');
  const countByArea = new Map<string, number>();
  for (const row of negative) {
    const area = riskAreaFor(row.categories, map);
    countByArea.set(area, (countByArea.get(area) ?? 0) + 1);
  }
  const areas = [...countByArea.keys()].sort();
  const day = source.generatedAt.toISOString().slice(0, 10);
  return {
    schemaVersion: 'eval-report/v1',
    run: {
      id: `live-feedback-${day}-${source.from.slice(0, 10)}-${source.to.slice(0, 10)}`,
      generatedAt: source.generatedAt.toISOString(),
      project: source.projectName,
      kind: 'production-feedback',
      configSnapshot: {
        redacted: true,
        source: 'langfuse-reporter',
        values: {
          cliVersion: source.cliVersion,
          windowFrom: source.from,
          windowTo: source.to,
          filter: source.where?.trim() ? source.where.trim() : 'none',
          ratingsTotal: rows.length,
          ratingsInWindow: source.ratingsInWindow ?? rows.length,
          ratingsPositive: rows.length - negative.length,
          ratingsNegative: negative.length,
        },
      },
    },
    suites: areas.map((riskArea) => ({
      id: suiteIdFor(riskArea),
      name: `Live feedback (thumbs-down): ${riskArea}`,
      total: countByArea.get(riskArea) ?? 0,
      passed: 0,
      failed: countByArea.get(riskArea) ?? 0,
      passRate: 0,
    })),
    suiteManifests: areas.map((riskArea) => ({
      name: suiteIdFor(riskArea),
      target: 'conversation',
      datasetSource: 'production-sample',
      datasetVersion: `${source.from.slice(0, 10)}_${source.to.slice(0, 10)}`,
      riskArea,
      graders: ['custom'],
      gate: { mode: 'report-only', thresholds: {} },
      description:
        'Real thumbs-down from customers. Every row is a failure by construction, so the pass rate says nothing about quality.',
    })),
    rows: negative.map((row) => toEvalRow(row, source, map)),
  };
}

export interface EvalReportFileRequest {
  outDir: string;
  stem: string;
  rows: readonly ExportRow[];
  source: EvalReportSource;
}

/** Writes eval-report-<stem>.json, or removes an earlier file of that name when no thumbs-down is selected. */
export async function writeEvalReportFile({
  outDir,
  stem,
  rows,
  source,
}: EvalReportFileRequest): Promise<{ path?: string; replaced: boolean }> {
  assertSafeStem(stem);
  await ensureOutDir(outDir);
  const path = join(outDir, `eval-report-${stem}.json`);
  const existed = existsSync(path);
  const report = buildEvalReport(rows, source);
  if (report.rows.length === 0) {
    if (existed) await rm(path);
    return { replaced: existed };
  }
  await writePrivateText(`${JSON.stringify(report, null, 2)}\n`, path);
  return { path, replaced: existed };
}
