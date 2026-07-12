import { z } from 'zod'

export const reviewSchema = z.object({
  id: z.number(),
  body: z.string(),
})

export type Review = z.infer<typeof reviewSchema>
