import { DEFAULT_ENGINE, type ReviewDTO } from '@devdigest/shared'
import { reviews } from './db/schema'
import { formatCreatedAt } from './format'

export async function createReview(body: string): Promise<ReviewDTO> {
  return {
    id: 1,
    body,
    createdAt: formatCreatedAt(new Date()),
    engine: DEFAULT_ENGINE,
  }
}

export const table = reviews
