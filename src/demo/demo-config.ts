import { configFileSchema, type ConfigFile } from '../config/config-schema.js';
import { DEMO_BASE_URL, DEMO_PROFILE_NAME } from './demo-constants.js';

/** The config a demo run uses instead of the file on disk, with two saved queries to try. */
export function demoConfig(): ConfigFile {
  return configFileSchema.parse({
    activeProfile: DEMO_PROFILE_NAME,
    profiles: { [DEMO_PROFILE_NAME]: { baseUrl: DEMO_BASE_URL } },
    queries: {
      'weekly-health': {
        window: 'last-month',
        rules: ['negative-rate <= 0.5', 'count >= 5'],
      },
      'no-harm': {
        window: 'last-month',
        where: 'category IN (harmful_content)',
        rules: ['count <= 0'],
      },
    },
  });
}
