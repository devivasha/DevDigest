import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const reviews = pgTable('reviews', {
  id: serial('id').primaryKey(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})
