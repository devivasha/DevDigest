import { z } from 'zod'

export const configSchema = z.object({
  port: z.number(),
  databaseUrl: z.string(),
})

export type AppConfig = z.infer<typeof configSchema>

export const config: AppConfig = {
  port: 3001,
  databaseUrl: process.env.DATABASE_URL ?? '',
}
