import { format } from 'date-fns'

export function formatCreatedAt(date: Date): string {
  return format(date, 'yyyy-MM-dd HH:mm')
}
