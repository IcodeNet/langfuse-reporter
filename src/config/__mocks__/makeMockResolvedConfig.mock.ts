import { DEFAULT_CONVENTIONS } from '../config-schema.js';
import type { ResolvedConfig } from '../resolve-config.js';

/** A complete, valid resolved config for tests; override only what the test is about. */
export function makeMockResolvedConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    profileName: 'dev',
    profile: { baseUrl: 'https://cloud.langfuse.com' },
    outDir: '/tmp/reports',
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
    windowIsDefault: true,
    publicKey: 'pk',
    secretKey: 'sk',
    conventions: DEFAULT_CONVENTIONS,
    llm: {},
    envFileProblem: undefined,
    llmApiKey: undefined,
    ...overrides,
  };
}
