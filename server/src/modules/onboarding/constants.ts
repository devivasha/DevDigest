/**
 * Onboarding Tour caps (AC-19). Every downstream section (skeleton.ts,
 * extractor.ts, service.ts) must respect these — facts.ts applies them first
 * so nothing downstream ever needs to re-bound the candidate set.
 */

/** Only the top-N ranked files are ever considered as fact candidates. */
export const TOP_N = 200;

/** Critical paths section cap. */
export const CRITICAL_MAX = 7;

/** Guided reading path section cap. */
export const READING_MAX = 7;

/** How-to-run commands section cap. */
export const COMMANDS_MAX = 10;

/** First tasks section cap. */
export const FIRST_TASKS_MAX = 5;

/** Architecture diagram node-count cap. */
export const DIAGRAM_NODES_MAX = 8;

/** Architecture narrative character cap. */
export const NARRATIVE_MAX = 1200;
