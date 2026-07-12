export interface ReviewDTO {
  id: number
  body: string
  createdAt: string
}

export const REVIEW_STATUSES = ['pending', 'complete', 'failed'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]
