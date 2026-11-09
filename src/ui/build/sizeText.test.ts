import { describe, expect, it } from 'vitest'
import { parseCm, parseMm } from './sizeText'

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

describe('parseMm', () => {
  it.each([
    ['5', 5],
    ['0', 0],
    ['12,5', 12.5],
    [' 2.5 ', 2.5],
    ['1,26', 1.3],
    ['50', 50],
  ])('reads %s', (text, mm) => {
    expect(parseMm(text)).toBe(mm)
  })

  it.each(['', 'abc', '-1', '1,2,3', '50,1', '1e2'])('rejects %s', (text) => {
    expect(parseMm(text)).toBeNull()
  })
})
