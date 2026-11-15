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

export function navigate(r: Route, opts: { replace?: boolean } = {}): void {
  const hash = routeHash(r)
  if (opts.replace) {
    // replaceState does not announce itself, so the listeners are told here.
    history.replaceState(history.state, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    location.hash = hash
  }
}

export function useRoute(): [Route, (r: Route, opts?: { replace?: boolean }) => void] {
  const hash = useSyncExternalStore(subscribe, currentHash)
  const route = useMemo(() => parseHash(hash), [hash])
  const go = useCallback((r: Route, opts?: { replace?: boolean }) => navigate(r, opts), [])
  return [route, go]
}
