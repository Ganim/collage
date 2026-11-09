import type { Store } from './store'

/** How a dead IndexedDB connection shows up; a call that fails this way wrote nothing lasting. */
function connectionLost(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === 'InvalidStateError' || e.name === 'UnknownError' || /connection/i.test(e.message))
  )
}

/**
 * Opens the store on first use and reopens it when the connection dies, which iOS does to
 * pages it suspends. Without this every later save would fail until the app was restarted.
 */
export function reopeningStore(open: () => Promise<Store>): Store {
  let opened: Promise<Store> | undefined
  const connect = () =>
    (opened ??= open().catch((e: unknown) => {
      opened = undefined
      throw e
    }))
  return new Proxy({} as Store, {
    get: (_target, key: string) => {
      // Not a thenable: awaiting the store must not call into IndexedDB.
      if (key === 'then') return undefined
      const call = async (args: unknown[]) => {
        const store = await connect()
        return (store[key as keyof Store] as (...a: unknown[]) => unknown)(...args)
      }
      return async (...args: unknown[]) => {
        try {
          return await call(args)
        } catch (e) {
          if (!connectionLost(e)) throw e
          opened = undefined
          return call(args)
        }
      }
    },
  })
}
