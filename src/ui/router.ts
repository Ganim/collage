import { useCallback, useMemo, useSyncExternalStore } from 'react'

export type Route =
  | { name: 'collections' }
  | { name: 'frames'; folderId?: string }
  | { name: 'mouldings' }
  | { name: 'editor'; id: string }
  | { name: 'share'; id: string }

/** Anything after "?" is left for the screen to read (the start page's "erro=1"). */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0] ?? ''
  const parts = path.split('/').filter(Boolean).map(decode)
  const [first, second, third] = parts
  if (first === 'molduras' && parts.length === 1) return { name: 'mouldings' }
  if (first === 'frames' && parts.length === 1) return { name: 'frames' }
  if (first === 'frames' && second && parts.length === 2)
    return { name: 'frames', folderId: second }
  if (first === 'c' && second && parts.length === 2) return { name: 'editor', id: second }
  if (first === 'c' && second && third === 'compartilhar' && parts.length === 3) {
    return { name: 'share', id: second }
  }
  return { name: 'collections' }
}

export function routeHash(r: Route): string {
  switch (r.name) {
    case 'collections':
      return '#/colecoes'
    case 'mouldings':
      return '#/molduras'
    case 'frames':
      return r.folderId ? `#/frames/${encodeURIComponent(r.folderId)}` : '#/frames'
    case 'editor':
      return `#/c/${encodeURIComponent(r.id)}`
    case 'share':
      return `#/c/${encodeURIComponent(r.id)}/compartilhar`
  }
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const currentHash = () => location.hash

/** What the app writes into the history entries it adds. */
interface EntryState {
  /** The address of the entry this one was added on top of. */
  collageFrom?: string
}

const entryState = (): EntryState | null =>
  typeof history.state === 'object' ? (history.state as EntryState | null) : null

// pushState and replaceState do not announce themselves, so the listeners are told here.
const announce = () => window.dispatchEvent(new HashChangeEvent('hashchange'))

export function navigate(r: Route, opts: { replace?: boolean } = {}): void {
  const hash = routeHash(r)
  if (opts.replace) {
    history.replaceState(history.state, '', hash)
    announce()
  } else if (hash !== location.hash) {
    const state: EntryState = { collageFrom: location.hash }
    history.pushState(state, '', hash)
    announce()
  }
}

/**
 * Leaves the current screen for `to` so that the back gesture does not return to it: the
 * current entry becomes `to`, and when the entry before it already is `to`, the app steps
 * back onto that one. Either way nothing in the history points at the screen that was left.
 */
export function leaveTo(to: Route): void {
  const hash = routeHash(to)
  const from = entryState()?.collageFrom
  navigate(to, { replace: true })
  if (from !== undefined && routeHash(parseHash(from)) === hash) history.back()
}

export function useRoute(): [Route, (r: Route, opts?: { replace?: boolean }) => void] {
  const hash = useSyncExternalStore(subscribe, currentHash)
  const route = useMemo(() => parseHash(hash), [hash])
  const go = useCallback((r: Route, opts?: { replace?: boolean }) => navigate(r, opts), [])
  return [route, go]
}
