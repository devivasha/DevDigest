import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { WebhookEvent, WebhookSubscription } from '@devdigest/shared';

/**
 * W1 — webhooks data-access. Owns `webhook_subscriptions`. Workspace-scoped
 * throughout.
 */

type WebhookRow = typeof t.webhookSubscriptions.$inferSelect;

export interface InsertWebhook {
  workspaceId: string;
  url: string;
  events: WebhookEvent[];
}

export class WebhooksRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<WebhookSubscription[]> {
    const rows = await this.db
      .select()
      .from(t.webhookSubscriptions)
      .where(eq(t.webhookSubscriptions.workspaceId, workspaceId))
      .orderBy(desc(t.webhookSubscriptions.createdAt));
    return rows.map((r) => this.toDomain(r));
  }

  async getById(workspaceId: string, id: string): Promise<WebhookSubscription | undefined> {
    const [row] = await this.db
      .select()
      .from(t.webhookSubscriptions)
      .where(
        and(
          eq(t.webhookSubscriptions.workspaceId, workspaceId),
          eq(t.webhookSubscriptions.id, id),
        ),
      );
    return row ? this.toDomain(row) : undefined;
  }

  async insert(values: InsertWebhook): Promise<WebhookSubscription> {
    const [row] = await this.db
      .insert(t.webhookSubscriptions)
      .values({
        workspaceId: values.workspaceId,
        url: values.url,
        events: values.events,
        active: true,
      })
      .returning();
    return this.toDomain(row!);
  }

  async setActive(
    workspaceId: string,
    id: string,
    active: boolean,
  ): Promise<WebhookSubscription | undefined> {
    const [row] = await this.db
      .update(t.webhookSubscriptions)
      .set({ active })
      .where(
        and(
          eq(t.webhookSubscriptions.workspaceId, workspaceId),
          eq(t.webhookSubscriptions.id, id),
        ),
      )
      .returning();
    return row ? this.toDomain(row) : undefined;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.webhookSubscriptions)
      .where(
        and(
          eq(t.webhookSubscriptions.workspaceId, workspaceId),
          eq(t.webhookSubscriptions.id, id),
        ),
      )
      .returning({ id: t.webhookSubscriptions.id });
    return rows.length > 0;
  }

  private toDomain(row: WebhookRow): WebhookSubscription {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      url: row.url,
      events: row.events as WebhookEvent[],
      active: row.active,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
