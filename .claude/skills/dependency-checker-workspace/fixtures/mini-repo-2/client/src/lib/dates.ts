import dayjs from 'dayjs'

export function formatShort(date: Date): string {
  return dayjs(date).format('YYYY-MM-DD')
}

export function fromNow(date: Date): string {
  return dayjs(date).toISOString()
}
