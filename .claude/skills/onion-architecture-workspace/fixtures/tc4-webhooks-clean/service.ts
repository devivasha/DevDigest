import type { Container } from '../../platform/container.js';
import type { WebhookEvent, WebhookSubscription } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { WebhooksRepository } from './repository.js';

/**
 * W1 — webhooks service. Manage outbound webhook subscriptions for a workspace.
 */

const MAX_WEBHOOKS_PER_WORKSPACE = 20;

export interface CreateWebhookInput {
  url: string;
  events: WebhookEvent[];
}

export class WebhooksService {
  private repo: WebhooksRepository;

  constructor(private container: Container) {
    this.repo = new WebhooksRepository(container.db);
  }

  async list(workspaceId: string): Promise<WebhookSubscription[]> {
    return this.repo.list(workspaceId);
  }

  async get(workspaceId: string, id: string): Promise<WebhookSubscription | undefined> {
    return this.repo.getById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateWebhookInput): Promise<WebhookSubscription> {
    const existing = await this.repo.list(workspaceId);
    if (existing.length >= MAX_WEBHOOKS_PER_WORKSPACE) {
      throw new AppError(
        'webhook_limit_exceeded',
        `A workspace may have at most ${MAX_WEBHOOKS_PER_WORKSPACE} webhooks`,
        422,
      );
    }
    return this.repo.insert({ workspaceId, url: input.url, events: input.events });
  }

  async setActive(
    workspaceId: string,
    id: string,
    active: boolean,
  ): Promise<WebhookSubscription | undefined> {
    return this.repo.setActive(workspaceId, id, active);
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }
}
