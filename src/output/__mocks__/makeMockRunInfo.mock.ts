import { DEFAULT_CONVENTIONS } from '../../config/config-schema.js';
import type { RunInfo } from '../run-info.js';

/** A complete, valid run description for tests; override only what the test is about. */
export function makeMockRunInfo(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    cliVersion: '0.1.0',
    generatedAt: new Date('2026-10-14T10:53:00.000Z'),
    profileName: 'dev',
    envFileName: 'dev.env',
    baseUrl: 'https://cloud.langfuse.com',
    from: '2026-10-13T00:00:00.000Z',
    to: '2026-10-15T00:00:00.000Z',
    where: undefined,
    conventions: DEFAULT_CONVENTIONS,
    ...overrides,
  };
}
