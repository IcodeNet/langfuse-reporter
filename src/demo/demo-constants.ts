export const DEMO_PROFILE_NAME = 'demo';

/** A reserved name that never resolves, so a trace link in a demo file cannot open a real page. */
export const DEMO_BASE_URL = 'https://demo.invalid';

export const DEMO_PROJECT_NAME = 'SAMPLE DATA (demo)';

/** True for the reserved address the demo profile uses; no real Langfuse can answer there. */
export function isDemoBaseUrl(baseUrl: string): boolean {
  return baseUrl === DEMO_BASE_URL;
}

export const DEMO_NOTICE = 'DEMO: built-in sample data; nothing is read from Langfuse';
