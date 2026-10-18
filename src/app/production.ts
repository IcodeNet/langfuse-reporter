const PRODUCTION_WORDS = /\bprod(?:uction)?\b|[-_]prod(?:uction)?(?:[-_]|$)/i;

/** True when the profile or the Langfuse project is named like production, so the run touches real customers. */
export function isProduction(profileName: string, projectName?: string): boolean {
  return PRODUCTION_WORDS.test(profileName) || PRODUCTION_WORDS.test(projectName ?? '');
}

/** The line shown once the project is known, naming both so a wrong profile is easy to spot. */
export function productionWarning(profileName: string, projectName: string): string {
  return `PRODUCTION: profile "${profileName}" reads project "${projectName}", which holds real customer conversations. Exports, reports and analyse handle their text; keep the files private.`;
}

/** Extra line for analyse, which sends the matching ratings' text to an outside model. */
export const PRODUCTION_ANALYSE_WARNING =
  'analyse on production sends real customer text to the configured model. Check that this is allowed before you continue.';
