import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import {
  slugify,
  disambiguateSlugs,
  buildManifestInput,
  buildManifestFile,
  buildAgentBundle,
  type CiAgentBundleInput,
  type CiSkillBundleInput,
} from './generate.js';
import { AGENTS_DIR, MEMORY_PATH, SKILLS_DIR } from './constants.js';

/**
 * T11 — hermetic unit tests for `generate.ts` (pure bundle-generation
 * functions, no DB/network). Covers AC-5, AC-13, AC-14, AC-27, AC-29.
 */

function makeAgent(overrides: Partial<CiAgentBundleInput> = {}): CiAgentBundleInput {
  return {
    name: 'Security Reviewer',
    provider: 'openrouter',
    model: 'anthropic/claude-3.5-sonnet',
    system_prompt: 'Review this PR for security issues.',
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    ...overrides,
  };
}

describe('slugify (AC-13)', () => {
  it('derives a deterministic, lowercase, hyphenated slug from the agent name', () => {
    // "Security Reviewer" must slugify to "security-reviewer" exactly (AC-13 observable).
    expect(slugify('Security Reviewer')).toBe('security-reviewer');
  });

  it('strips characters outside [a-z0-9-] rather than escaping them', () => {
    // Path-safety: a name containing traversal-like sequences must never
    // reproduce "/" or ".." in the slug.
    expect(slugify('../../.github/workflows/evil')).not.toMatch(/[./]/);
    expect(slugify('../../.github/workflows/evil')).not.toContain('..');
  });
});

describe('disambiguateSlugs (AC-14)', () => {
  it('appends a short deterministic suffix on collision so every slug is unique — no overwrite', () => {
    // "Auth" and "auth!" both slugify to "auth" — the second occurrence must
    // become a distinct slug so no file overwrites the other.
    const slugs = disambiguateSlugs(['Auth', 'auth!']);
    expect(slugs).toHaveLength(2);
    expect(new Set(slugs).size).toBe(2);
    expect(slugs[0]).toBe('auth');
    expect(slugs[1]).not.toBe('auth');
  });

  it('is deterministic — the same input list always produces the same output list', () => {
    const first = disambiguateSlugs(['Auth', 'auth!', 'AUTH']);
    const second = disambiguateSlugs(['Auth', 'auth!', 'AUTH']);
    expect(second).toEqual(first);
  });
});

describe('manifest generation — AgentManifest validation (AC-5)', () => {
  it('emits YAML that validates against the shared AgentManifest schema for a normal agent', () => {
    const agent = makeAgent();
    const input = buildManifestInput(agent, ['security-reviewer-skill']);
    const file = buildManifestFile(input, 'security-reviewer');

    // AC-5 observable: parsing the previewed/shipped YAML with AgentManifest succeeds.
    const parsed = AgentManifest.parse(parseYaml(file.contents));
    expect(parsed.name).toBe(agent.name);
    expect(parsed.model).toBe(agent.model);
    expect(parsed.skills).toEqual(['security-reviewer-skill']);
    expect(file.path).toBe(`${AGENTS_DIR}security-reviewer.yaml`);
  });

  it('buildManifestFile throws rather than shipping an invalid manifest', () => {
    // A manifest with an empty name violates AgentManifest's `.min(1)` — the
    // generator must never silently ship/render an invalid manifest (AC-5).
    const agent = makeAgent({ name: '' });
    const input = buildManifestInput(agent, []);
    expect(() => buildManifestFile(input, 'x')).toThrow();
  });
});

describe('YAML metacharacter round-trip (AC-29)', () => {
  it('safely encodes name/system-prompt metacharacters so they round-trip unchanged', () => {
    const trickyName = 'Reviewer: "Critical" - #1';
    const trickySystemPrompt = [
      'Line one: contains a colon.',
      '# looks like a comment but is not',
      '- looks like a YAML list item but is not',
      'Multi-line prompt with a trailing colon:',
    ].join('\n');

    const agent = makeAgent({ name: trickyName, system_prompt: trickySystemPrompt });
    const input = buildManifestInput(agent, []);
    const file = buildManifestFile(input, 'reviewer');

    // AC-29 observable: round-trips through AgentManifest UNCHANGED after re-parse.
    const reparsed = AgentManifest.parse(parseYaml(file.contents));
    expect(reparsed.name).toBe(trickyName);
    expect(reparsed.system_prompt).toBe(trickySystemPrompt);
  });
});

describe('skill-less bundle (AC-27)', () => {
  it('omits .devdigest/skills/*.md and the manifest skills field parses to []', () => {
    const agent = makeAgent();
    const bundle = buildAgentBundle(agent, []);

    // No skill files at all in the assembled bundle.
    const skillFiles = bundle.files.filter((f) => f.path.startsWith(SKILLS_DIR));
    expect(skillFiles).toHaveLength(0);

    // The manifest file's `skills` field parses to `[]` (never null/undefined).
    const manifestFile = bundle.files.find((f) => f.path.endsWith('.yaml'));
    expect(manifestFile).toBeDefined();
    const parsed = AgentManifest.parse(parseYaml(manifestFile!.contents));
    expect(parsed.skills).toEqual([]);

    // The empty memory.jsonl is still present (AC-4).
    const memoryFile = bundle.files.find((f) => f.path === MEMORY_PATH);
    expect(memoryFile).toBeDefined();
    expect(memoryFile!.contents).toBe('');
  });

  it('emits one skill file per linked skill when skills ARE present', () => {
    const agent = makeAgent();
    const skills: CiSkillBundleInput[] = [
      { name: 'Auth', body: '# Auth skill body' },
      { name: 'auth!', body: '# Second auth-named skill body' },
    ];
    const bundle = buildAgentBundle(agent, skills);

    const skillFiles = bundle.files.filter((f) => f.path.startsWith(SKILLS_DIR));
    // AC-14: two distinct skill files, no overwrite, even though both names
    // slugify to the same base slug.
    expect(skillFiles).toHaveLength(2);
    const paths = skillFiles.map((f) => f.path);
    expect(new Set(paths).size).toBe(2);
    expect(skillFiles[0]!.contents).toBe('# Auth skill body');
    expect(skillFiles[1]!.contents).toBe('# Second auth-named skill body');
  });
});
