import { runPipeline } from '@devdigest/reviewer-core/pipeline'
import type { ReviewDTO } from '@devdigest/shared'
import { reviews } from './db/schema'

export async function createReview(body: string): Promise<ReviewDTO> {
  const result = await runPipeline(body)
  return {
    id: 1,
    body: result.summary,
    createdAt: new Date().toISOString(),
  }
}

export const table = reviews
