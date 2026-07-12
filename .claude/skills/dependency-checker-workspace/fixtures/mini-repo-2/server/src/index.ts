import Fastify from 'fastify'
import { config } from './config'
import { createReview } from './service'
import type { ReviewStatus } from '@devdigest/shared'

const app = Fastify()

app.post('/reviews', async () => {
  const status: ReviewStatus = 'pending'
  const review = await createReview('example')
  return { review, status }
})

app.listen({ port: config.port })
