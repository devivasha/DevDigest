import { format } from 'date-fns'
import moment from 'moment'

export function formatShort(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function fromNow(date: Date): string {
  return moment(date).fromNow()
}
