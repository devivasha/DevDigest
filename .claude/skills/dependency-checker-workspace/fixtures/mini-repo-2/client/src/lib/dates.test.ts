import { describe, it, expect } from 'vitest'
import { formatShort } from './dates'

describe('formatShort', () => {
  it('formats to yyyy-mm-dd', () => {
    expect(formatShort(new Date('2026-01-02T00:00:00Z'))).toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})
