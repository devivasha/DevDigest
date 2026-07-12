import { describe, it, expect } from 'vitest'
import { config } from './config'

describe('config', () => {
  it('has a numeric port', () => {
    expect(typeof config.port).toBe('number')
  })
})
