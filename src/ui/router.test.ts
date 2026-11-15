import { describe, expect, it } from 'vitest'
import { parseHash, routeHash, type Route } from './router'

describe('router', () => {
  const routes: [Route, string][] = [
    [{ name: 'collections' }, '#/colecoes'],
    [{ name: 'mouldings' }, '#/molduras'],
    [{ name: 'frames' }, '#/frames'],
    [{ name: 'frames', folderId: 'f1' }, '#/frames/f1'],
    [{ name: 'editor', id: 'abc' }, '#/c/abc'],
    [{ name: 'share', id: 'abc' }, '#/c/abc/compartilhar'],
  ]

  it.each(routes)('%o goes to %s and back', (route, hash) => {
    expect(routeHash(route)).toBe(hash)
    expect(parseHash(hash)).toEqual(route)
  })

  it("reads '#/c/abc/compartilhar' as sharing abc", () => {
    expect(parseHash('#/c/abc/compartilhar')).toEqual({ name: 'share', id: 'abc' })
  })

  it('falls back to the collections for an empty or unknown hash', () => {
    expect(parseHash('')).toEqual({ name: 'collections' })
    expect(parseHash('#/xyz')).toEqual({ name: 'collections' })
    expect(parseHash('#/c/')).toEqual({ name: 'collections' })
  })

  it('ignores what comes after a question mark', () => {
    expect(parseHash('#/entrar?erro=1')).toEqual({ name: 'collections' })
    expect(parseHash('#/c/abc?x=1')).toEqual({ name: 'editor', id: 'abc' })
  })

  it('keeps ids with unusual characters intact', () => {
    const route: Route = { name: 'editor', id: 'a b/c' }
    expect(parseHash(routeHash(route))).toEqual(route)
  })
})
