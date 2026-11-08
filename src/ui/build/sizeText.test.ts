import { describe, expect, it } from 'vitest'
import { parseCm } from './sizeText'

describe('parseCm', () => {
  it.each([
    ['10,5', 105],
    ['10.3', 103],
    ['12', 120],
    [' 7,25 ', 73],
    ['1', 10],
    ['100', 1000],
  ])('reads %j as %i mm', (value, mm) => {
    expect(parseCm(value)).toBe(mm)
  })

  it.each(['', '   ', 'abc', '0', '0,9', '100,1', '999', '-5', '1,2,3', '1e2', '10cm', 'Infinity'])(
    'rejects %j',
    (value) => {
      expect(parseCm(value)).toBeNull()
    },
  )
})
