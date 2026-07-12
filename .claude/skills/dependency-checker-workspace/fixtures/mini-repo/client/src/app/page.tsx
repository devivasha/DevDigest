import type { ReviewDTO } from '@devdigest/shared'
import { formatShort } from '../lib/dates'
import { reviewSchema } from '../lib/api'

export default function Page() {
  const now = formatShort(new Date())
  const dto: ReviewDTO = { id: 1, body: 'hello', createdAt: now }
  reviewSchema.parse(dto)
  return <main>{dto.body}</main>
}
