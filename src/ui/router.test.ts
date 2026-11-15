import { describe, expect, it } from 'vitest'
import { leaveTo, navigate, parseHash, routeHash, type Route } from './router'

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

describe('leaving a screen', () => {
  const steppedBack = () =>
    new Promise<void>((resolve) =>
      window.addEventListener('popstate', () => resolve(), { once: true }),
    )

  it('steps back onto the entry it came from, so back does not return', async () => {
    navigate({ name: 'collections' }, { replace: true })
    const length = history.length
    navigate({ name: 'editor', id: 'x' })
    expect(history.length).toBe(length + 1)
    const back = steppedBack()
    leaveTo({ name: 'collections' })
    expect(location.hash).toBe('#/colecoes')
    await back
    expect(location.hash).toBe('#/colecoes')
    expect((history.state as { collageFrom?: string } | null)?.collageFrom).not.toBe('#/c/x')
  })

  it('takes the place of the screen it leaves when it came from somewhere else', () => {
    navigate({ name: 'editor', id: 'x' }, { replace: true })
    navigate({ name: 'editor', id: 'copy' })
    const length = history.length
    leaveTo({ name: 'collections' })
    expect(history.length).toBe(length)
    expect(location.hash).toBe('#/colecoes')
  })

  it('does not add an entry for the address already shown', () => {
    navigate({ name: 'collections' }, { replace: true })
    const length = history.length
    navigate({ name: 'collections' })
    expect(history.length).toBe(length)
  })
})
