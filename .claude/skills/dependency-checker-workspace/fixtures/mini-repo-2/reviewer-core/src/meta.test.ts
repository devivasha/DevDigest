import { describe, it, expect } from 'vitest'
import { engineName } from './meta'

describe('engineName', () => {
  it('is a non-empty string', () => {
    expect(engineName.length).toBeGreaterThan(0)
  })
})
