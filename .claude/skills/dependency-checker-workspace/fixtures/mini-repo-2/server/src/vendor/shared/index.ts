import { engineName } from '@devdigest/reviewer-core/meta'

export interface ReviewDTO {
  id: number
  body: string
  createdAt: string
  engine: string
}

export const REVIEW_STATUSES = ['pending', 'complete', 'failed'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const DEFAULT_ENGINE = engineName
