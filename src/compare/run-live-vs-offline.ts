import { readFile } from 'node:fs/promises';
import type { Reporter } from '../ui/reporter.js';
import {
  compareLiveWithOffline,
  parseEvalReport,
  type AreaComparison,
  type LiveVsOffline,
} from './live-vs-offline.js';

export interface LiveVsOfflineRequest {
  offlinePath: string;
  livePath: string;
  reporter: Reporter;
  json: boolean;
}

function percent(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function tableRows(areas: readonly AreaComparison[]): Array<[string, string]> {
  return areas.map((area) => [
    area.riskArea,
    `offline fail ${percent(area.offlineFailRate)} (${area.offlineFailed}/${area.offlineTotal}); live thumbs-down ${area.liveThumbsDown}, ${percent(area.liveThumbsDownShare)} of ratings`,
  ]);
}

async function readReport(path: string, label: string) {
  try {
    return parseEvalReport(await readFile(path, 'utf8'));
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new Error(`Could not read the ${label} report ${path} as eval-report/v1: ${reason}`, {
      cause: err,
    });
  }
}

/** Compares an offline eval report with a live-feedback report, risk area by risk area. Returns the result. */
export async function runLiveVsOffline({
  offlinePath,
  livePath,
  reporter,
  json,
}: LiveVsOfflineRequest): Promise<LiveVsOffline> {
  const task = reporter.task('Reading the two eval reports', 'fetch');
  const offline = await readReport(offlinePath, 'offline');
  const live = await readReport(livePath, 'live');
  const result = compareLiveWithOffline(offline, live);
  task.succeed(`Compared ${result.areas.length} risk areas`);
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  reporter.block({
    title: 'Live feedback against offline evals',
    emoji: '⚖️',
    rows: tableRows(result.areas),
  });
  if (result.liveFiltered && result.windowTotalKnown) {
    reporter.info(
      `The live file was made with a filter, so it only holds some of the thumbs-down. The shares are still out of all ${result.liveRatingsTotal} ratings in the window.`,
    );
  }
  if (result.liveFiltered && !result.windowTotalKnown) {
    reporter.warn(
      'The live file was made with a filter and is an older file that does not say how many ratings the window held, so the shares are out of the filtered count and read too high. Export again to get true shares.',
    );
  }
  reporter.info(
    'Both rates describe different things: offline is the share of eval rows that failed; live is the share of all ratings that were a thumbs-down in this area.',
  );
  return result;
}
