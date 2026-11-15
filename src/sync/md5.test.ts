import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { md5 } from './md5'

describe('md5', () => {
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
  ])('md5(%j) is %s', (text, hex) => {
    expect(md5(text)).toBe(hex)
  })

  it('hashes the UTF-8 bytes of a string, and bytes as they are', () => {
    expect(md5('Coleção ✨')).toBe(createHash('md5').update('Coleção ✨', 'utf8').digest('hex'))
    const bytes = new Uint8Array([0, 255, 128, 7])
    expect(md5(bytes)).toBe(createHash('md5').update(bytes).digest('hex'))
  })

  it('matches across block boundaries (55, 56, 64 and 1000 bytes)', () => {
    for (const n of [55, 56, 63, 64, 65, 1000]) {
      const text = 'a'.repeat(n)
      expect(md5(text)).toBe(createHash('md5').update(text).digest('hex'))
    }
  })
})
