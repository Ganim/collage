import { describe, expect, it } from 'vitest'
import { uniqueName } from './names'

describe('uniqueName', () => {
  it('keeps a name nobody has', () => {
    expect(uniqueName('Fotos de 9 de novembro', [])).toBe('Fotos de 9 de novembro')
  })

  it('numbers a name already taken, starting at 2', () => {
    expect(uniqueName('A', ['A'])).toBe('A (2)')
  })

  it('skips the numbers already taken', () => {
    expect(uniqueName('A', ['A', 'A (2)'])).toBe('A (3)')
  })
})
