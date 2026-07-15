import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  AgentManifest,
  type AgentManifestInput,
  type CiFailOn,
  type CiFile,
  type Provider,
  type ReviewStrategy,
} from '@devdigest/shared';
import { AGENTS_DIR, MEMORY_PATH, SKILLS_DIR } from './constants.js';

/**
 * T3 — bundle generation: slug derivation, manifest build/validate, and the
 * full `CiFile[]` assembly (agent manifest, skill bodies, empty memory log).
 *
 * PURE functions only — no DB, no filesystem, no adapter instantiation. The
 * PR/zip/persistence side-effects belong to the `ci` service (T5).
 */

// ---------------------------------------------------------------------------
// Inputs (deliberately NOT the full shared `Agent`/`Skill` contracts — the
// service picks only the fields the bundle needs, keeping this module's
// public surface small and independent of how T4/T5 fetch the data).
// ---------------------------------------------------------------------------

export interface CiAgentBundleInput {
  name: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  strategy: ReviewStrategy;
  ci_fail_on: CiFailOn;
}

export interface CiSkillBundleInput {
  /** Skill name — slugified for `.devdigest/skills/<slug>.md` (AC-13). */
  name: string;
  /** Markdown body written verbatim as the skill file's contents. */
  body: string;
}

export interface CiBundleResult {
  files: CiFile[];
  /** The slug used for `.devdigest/agents/<agentSlug>.yaml` (AC-13). */
  agentSlug: string;
  /** Slugs used for each linked skill, in the same order as the input array. */
  skillSlugs: string[];
}

// ---------------------------------------------------------------------------
// Slugify (AC-13) + in-bundle disambiguator (AC-14)
// ---------------------------------------------------------------------------

/**
 * Deterministic, lowercase, hyphenated slug (AC-13 — "Security Reviewer" →
 * "security-reviewer"). Strips every character outside `[a-z0-9-]` rather
 * than escaping it: this doubles as a path-safety guard, since the slug is
 * concatenated directly into a file path (`AGENTS_DIR + slug + '.yaml'`) —
 * a name containing `../` or an absolute path can never produce a slug that
 * escapes the bundle's `.devdigest/` directories.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

/**
 * Slugifies every name and appends a short deterministic suffix (`-2`,
 * `-3`, …) on collision, so every emitted filename within the bundle is
 * unique (AC-14 — "Auth" and "auth!" both slugify to "auth"; the second
 * occurrence becomes "auth-2"). The suffix is derived purely from
 * occurrence order in the input array, so the same input list always
 * produces the same output list (no randomness, no overwrite).
 */
export function disambiguateSlugs(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = slugify(name);
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return occurrence === 1 ? base : `${base}-${occurrence}`;
  });
}

// ---------------------------------------------------------------------------
// Manifest (AC-5, AC-27, AC-29)
// ---------------------------------------------------------------------------

/**
 * Builds the `AgentManifestInput` for a single agent + its resolved skill
 * slugs. `skills` is always an explicit array (never `undefined`/`null`) so
 * a skill-less agent serializes as `skills: []` directly — no reliance on
 * `AgentManifest`'s null→[] transform for the WRITE path (that transform
 * exists for the runner's READ path, where hand-edited YAML might omit the
 * key or leave it empty).
 */
export function buildManifestInput(
  agent: CiAgentBundleInput,
  skillSlugs: string[],
): AgentManifestInput {
  return {
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.system_prompt,
    skills: skillSlugs,
    strategy: agent.strategy,
    ci_fail_on: agent.ci_fail_on,
  };
}

/**
 * Serializes the manifest with the `yaml` package (safe value encoding for
 * `:`, `#`, `-`, newlines, etc. — AC-29; never manual string concatenation)
 * and re-parses + validates the emitted text against the shared
 * `AgentManifest` schema before returning (AC-5). Throws if the emitted
 * YAML fails validation — an invalid manifest must never be shown or
 * shipped.
 */
export function buildManifestFile(input: AgentManifestInput, agentSlug: string): CiFile {
  const contents = stringifyYaml(input);

  // AC-5: validate the SHIPPED bytes, not the pre-serialization object —
  // catches any round-trip drift the YAML library itself might introduce.
  const reparsed: unknown = parseYaml(contents);
  AgentManifest.parse(reparsed);

  return {
    path: `${AGENTS_DIR}${agentSlug}.yaml`,
    contents,
    editable: true,
  };
}

// ---------------------------------------------------------------------------
// Skill files + memory.jsonl (AC-4, AC-27)
// ---------------------------------------------------------------------------

function buildSkillFiles(skills: CiSkillBundleInput[], skillSlugs: string[]): CiFile[] {
  return skills.map((skill, i) => ({
    path: `${SKILLS_DIR}${skillSlugs[i]}.md`,
    contents: skill.body,
    editable: true,
  }));
}

function buildMemoryFile(): CiFile {
  return {
    path: MEMORY_PATH,
    contents: '',
    editable: true,
  };
}

// ---------------------------------------------------------------------------
// Full assembly
// ---------------------------------------------------------------------------

/**
 * Assembles the manifest + skill files + empty memory.jsonl for one agent
 * (AC-4). WHEN `skills` is empty, no `.devdigest/skills/*.md` file is
 * emitted at all and the manifest's `skills` field is `[]` (AC-27). The
 * workflow yml is NOT included here — see `workflow.ts` — because it is
 * generated from `CiExportInput` (triggers/post_as/target), not from agent
 * data.
 */
export function buildAgentBundle(
  agent: CiAgentBundleInput,
  skills: CiSkillBundleInput[],
): CiBundleResult {
  const agentSlug = slugify(agent.name);
  const skillSlugs = disambiguateSlugs(skills.map((s) => s.name));

  const manifestInput = buildManifestInput(agent, skillSlugs);
  const manifestFile = buildManifestFile(manifestInput, agentSlug);
  const skillFiles = buildSkillFiles(skills, skillSlugs);
  const memoryFile = buildMemoryFile();

  return {
    files: [manifestFile, ...skillFiles, memoryFile],
    agentSlug,
    skillSlugs,
  };
}
