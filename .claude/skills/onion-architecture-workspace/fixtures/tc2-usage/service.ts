import { and, eq, gte } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { OpenAIProvider } from '../../adapters/llm/openai.js';

/**
 * U1 — usage service. Aggregates token usage per workspace and produces a
 * short natural-language summary for the usage banner.
 */

export class UsageService {
  constructor(private container: Container) {}

  async monthlyTokens(workspaceId: string, since: Date): Promise<number> {
    const rows = await this.container.db
      .select()
      .from(t.runLogs)
      .where(and(eq(t.runLogs.workspaceId, workspaceId), gte(t.runLogs.createdAt, since)));
    return rows.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0);
  }

  async summarizeUsage(workspaceId: string): Promise<string> {
    const llm = new OpenAIProvider(process.env.OPENAI_API_KEY!);
    const total = await this.monthlyTokens(workspaceId, new Date(0));
    const res = await llm.complete({ prompt: `Summarize usage for the month: ${total} tokens.` });
    return res.text;
  }
}
