import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ConventionCandidate } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { getFeatureModelOverride } from '../settings/feature-models.js';
import { routeModel } from '../../platform/model-router.js';
import * as t from '../../db/schema.js';
import { ConventionsRepository } from './repository.js';
import { toConventionDto, buildSkillBody, CONFIG_FILES } from './helpers.js';

const MAX_FILE_LINES = 200;

const LLMCandidate = z.object({
  category: z.string(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
});

const LLMResponse = z.object({
  candidates: z.array(LLMCandidate),
});

const SYSTEM_PROMPT = `\
You are a code-conventions analyst. You will be given source files from a software repository.
Extract coding conventions that are clearly demonstrated in the evidence.

For each convention return:
- category: high-level area (e.g. "TypeScript", "Error Handling", "Imports", "Naming", "Testing", "API Design")
- rule: a concise, actionable rule statement (one sentence, imperative mood)
- evidence_path: the RELATIVE path of the file that best demonstrates this rule
- evidence_snippet: a short code excerpt (≤5 lines) that demonstrates the rule
- confidence: 0–1 score reflecting how clearly and consistently the rule is enforced

Return 8–20 candidates. Only extract rules that appear consistently — no one-offs.
Avoid generic advice; each rule must be evidenced by the provided source files.`;

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  /**
   * Full scan: samples files → LLM → verify evidence → persist (replacing prior scan).
   * File I/O lives here in the server module; reviewer-core stays pure.
   */
  async scan(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const [repo] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, repoId));

    if (!repo?.clonePath) return [];

    const { clonePath, name: repoName } = repo;

    // 1. Read config files (best-effort)
    const configSections: string[] = [];
    for (const cfgFile of CONFIG_FILES) {
      const content = await readFile(join(clonePath, cfgFile), 'utf8').catch(() => null);
      if (content) {
        configSections.push(`### ${cfgFile}\n\`\`\`\n${truncateLines(content, MAX_FILE_LINES)}\n\`\`\``);
      }
    }

    // 2. Top-ranked source files from repoIntel
    const samplePaths = await this.container.repoIntel.getConventionSamples(repoId, 12);
    const sourceSections: string[] = [];
    for (const relPath of samplePaths) {
      const content = await readFile(join(clonePath, relPath), 'utf8').catch(() => null);
      if (content) {
        sourceSections.push(`### ${relPath}\n\`\`\`\n${truncateLines(content, MAX_FILE_LINES)}\n\`\`\``);
      }
    }

    const allSections = [...configSections, ...sourceSections];
    if (allSections.length === 0) return [];

    const userContent = `Repository: ${repoName}\n\n${allSections.join('\n\n')}`;

    // 3. Resolve model — workspace override first, then whichever key is configured
    const override = await getFeatureModelOverride(this.container, workspaceId, 'conventions');
    let resolvedProvider: 'openai' | 'anthropic' | 'openrouter';
    let model: string;
    if (override && (override.provider === 'openai' || override.provider === 'anthropic' || override.provider === 'openrouter')) {
      resolvedProvider = override.provider as typeof resolvedProvider;
      model = override.model;
    } else {
      // Auto-detect: prefer Anthropic, then OpenAI (avoid failing when only one key is set)
      const anthropicKey = await this.container.secrets.get('ANTHROPIC_API_KEY');
      const openaiKey = await this.container.secrets.get('OPENAI_API_KEY');
      if (anthropicKey) {
        resolvedProvider = 'anthropic';
        model = routeModel('classify', 'anthropic');
      } else if (openaiKey) {
        resolvedProvider = 'openai';
        model = routeModel('classify', 'openai');
      } else {
        return [];
      }
    }
    const llm = await this.container.llm(resolvedProvider);

    // 4. Call LLM
    let rawCandidates: z.infer<typeof LLMCandidate>[] = [];
    try {
      const result = await llm.completeStructured({
        model,
        schema: LLMResponse,
        schemaName: 'ExtractConventions',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
        maxTokens: 4096,
      });
      rawCandidates = result.data.candidates;
    } catch {
      return [];
    }

    // 5. Verify candidates: file must exist and snippet must appear in it
    const verified: Array<z.infer<typeof LLMCandidate>> = [];
    for (const c of rawCandidates) {
      if (!c.evidence_path || !c.evidence_snippet) continue;
      const content = await readFile(join(clonePath, c.evidence_path), 'utf8').catch(() => null);
      if (content === null) continue;
      if (!content.includes(c.evidence_snippet.trim())) continue;
      verified.push(c);
    }

    // 6. Replace previous scan atomically (delete then insert)
    await this.repo.deleteByRepo(workspaceId, repoId);
    const inserted = await this.repo.insertBatch(
      verified.map((c) => ({
        workspaceId,
        repoId,
        category: c.category,
        rule: c.rule,
        evidencePath: c.evidence_path,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
      })),
    );

    return inserted.map(toConventionDto);
  }

  async setAccepted(
    workspaceId: string,
    id: string,
    accepted: boolean,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.setAccepted(workspaceId, id, accepted);
    return row ? toConventionDto(row) : undefined;
  }

  async updateRule(
    workspaceId: string,
    id: string,
    rule: string,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.updateRule(workspaceId, id, rule);
    return row ? toConventionDto(row) : undefined;
  }

  /** Return a pre-rendered skill body for the "Create skill" modal. No persist. */
  async buildSkillBodyForRepo(workspaceId: string, repoId: string): Promise<string> {
    const [repo] = await this.container.db
      .select({ name: t.repos.name })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    const candidates = await this.list(workspaceId, repoId);
    return buildSkillBody(repo?.name ?? 'repo', candidates);
  }
}

function truncateLines(text: string, max: number): string {
  const lines = text.split('\n');
  if (lines.length <= max) return text;
  return lines.slice(0, max).join('\n') + `\n… (truncated at ${max} lines)`;
}
