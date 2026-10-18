import { z } from 'zod';

const suiteSchema = z.object({ id: z.string(), total: z.number(), passed: z.number() });
const manifestSchema = z.object({ name: z.string(), riskArea: z.string() });
const rowSchema = z.object({ metadata: z.object({ riskArea: z.string().optional() }).optional() });

/** The parts of an eval-report/v1 file this comparison reads; everything else is ignored. */
const reportSchema = z.object({
  schemaVersion: z.literal('eval-report/v1'),
  suites: z.array(suiteSchema),
  suiteManifests: z.array(manifestSchema).optional(),
  rows: z.array(rowSchema),
  run: z.object({
    configSnapshot: z.object({ values: z.record(z.string(), z.unknown()) }).optional(),
  }),
});

export type EvalReportInput = z.infer<typeof reportSchema>;

export function parseEvalReport(text: string): EvalReportInput {
  return reportSchema.parse(JSON.parse(text));
}

export interface AreaComparison {
  riskArea: string;
  /** Offline rows in suites that declare this risk area; 0 when no offline suite does. */
  offlineTotal: number;
  offlineFailed: number;
  /** Failed share of offline rows, or undefined when there are none. */
  offlineFailRate: number | undefined;
  /** Live thumbs-down whose reasons map to this risk area. */
  liveThumbsDown: number;
  /** Thumbs-down in this area as a share of all live ratings, or undefined when the count is unknown. */
  liveThumbsDownShare: number | undefined;
}

export interface LiveVsOffline {
  areas: AreaComparison[];
  liveRatingsTotal: number | undefined;
  /** True when the live file came from a filtered export. */
  liveFiltered: boolean;
  /** False when the live file is old and cannot give a true share for a filtered export. */
  windowTotalKnown: boolean;
}

/** Every rating in the window when the file records it; older files only have the selected count. */
function liveRatingsTotal(live: EvalReportInput): number | undefined {
  const values = live.run.configSnapshot?.values;
  const value = values?.ratingsInWindow ?? values?.ratingsTotal;
  return typeof value === 'number' && value > 0 ? value : undefined;
}

/** True when the live file was made with a filter, so its counts cover only part of the window. */
function liveWasFiltered(live: EvalReportInput): boolean {
  const filter = live.run.configSnapshot?.values.filter;
  return typeof filter === 'string' && filter !== 'none';
}

/** True when the file says how many ratings the window held; without it a filtered file cannot give a true share. */
function windowTotalKnown(live: EvalReportInput): boolean {
  return typeof live.run.configSnapshot?.values.ratingsInWindow === 'number';
}

function offlineByArea(offline: EvalReportInput): Map<string, { total: number; failed: number }> {
  const areaOf = new Map((offline.suiteManifests ?? []).map((m) => [m.name, m.riskArea]));
  const totals = new Map<string, { total: number; failed: number }>();
  for (const suite of offline.suites) {
    const area = areaOf.get(suite.id);
    if (area === undefined) continue;
    const entry = totals.get(area) ?? { total: 0, failed: 0 };
    entry.total += suite.total;
    entry.failed += suite.total - suite.passed;
    totals.set(area, entry);
  }
  return totals;
}

function liveByArea(live: EvalReportInput): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of live.rows) {
    const area = row.metadata?.riskArea ?? 'custom';
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return counts;
}

/** One line per risk area that either side mentions, sorted by name. Suites with no declared area are left out. */
export function compareLiveWithOffline(
  offline: EvalReportInput,
  live: EvalReportInput,
): LiveVsOffline {
  const offlineAreas = offlineByArea(offline);
  const liveAreas = liveByArea(live);
  const total = liveRatingsTotal(live);
  const names = [...new Set([...offlineAreas.keys(), ...liveAreas.keys()])].sort();
  const areas = names.map((riskArea): AreaComparison => {
    const off = offlineAreas.get(riskArea);
    const liveCount = liveAreas.get(riskArea) ?? 0;
    return {
      riskArea,
      offlineTotal: off?.total ?? 0,
      offlineFailed: off?.failed ?? 0,
      offlineFailRate: off && off.total > 0 ? off.failed / off.total : undefined,
      liveThumbsDown: liveCount,
      liveThumbsDownShare: total === undefined ? undefined : liveCount / total,
    };
  });
  return {
    areas,
    liveRatingsTotal: total,
    liveFiltered: liveWasFiltered(live),
    windowTotalKnown: windowTotalKnown(live),
  };
}
