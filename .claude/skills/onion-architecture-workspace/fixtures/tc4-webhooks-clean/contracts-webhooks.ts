/**
 * W1 — webhooks contracts. Outbound webhook subscriptions per workspace,
 * shared between the webhooks module and the client settings page.
 */

export type WebhookEvent = 'pull_request' | 'push' | 'review';

export interface WebhookSubscription {
  id: string;
  workspaceId: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
}
