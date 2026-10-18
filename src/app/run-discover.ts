import type { LangfuseClient } from '../langfuse/langfuse-client.js';
import type { ResolvedConfig } from '../config/resolve-config.js';
import type { Reporter } from '../ui/reporter.js';
import { makeClient } from './load-dataset.js';

/** The parts of the Langfuse client discovery uses; a test supplies a fake. */
export type DiscoverClient = Pick<
  LangfuseClient,
  'getProject' | 'listObservationNames' | 'listScoreNames'
>;

export interface Discovery {
  project: { id: string; name: string };
  observationNames: string[];
  scoreNames: string[];
  /** What the current settings match, so a page can show a tick or a hint. */
  current: {
    turnNameFound: boolean;
    ratingScoreFound: boolean;
    /** Score names that start with the reason prefix, minus the rating itself. */
    reasonScoreNames: string[];
  };
}

export interface DiscoverRequest {
  resolved: ResolvedConfig;
  reporter: Reporter;
  now: Date;
  createClient?: (resolved: ResolvedConfig, reporter: Reporter) => DiscoverClient;
}

/** Reads the names a project uses. Read-only, and it returns names, never keys or customer text. */
export async function discover(request: DiscoverRequest): Promise<Discovery> {
  const { resolved, reporter, now } = request;
  const client = (request.createClient ?? makeClient)(resolved, reporter);
  const [project, observationNames, scoreNames] = await Promise.all([
    client.getProject(),
    client.listObservationNames(now),
    client.listScoreNames(now),
  ]);
  const { turnName, ratingScore, reasonScorePrefix } = resolved.conventions;
  return {
    project,
    observationNames,
    scoreNames,
    current: {
      turnNameFound: observationNames.includes(turnName),
      ratingScoreFound: scoreNames.includes(ratingScore),
      reasonScoreNames: scoreNames.filter(
        (name) => name !== ratingScore && name.startsWith(reasonScorePrefix),
      ),
    },
  };
}
