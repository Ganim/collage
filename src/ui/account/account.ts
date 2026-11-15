export interface Account {
  email: string
  name: string | null
  picture: string | null
}

/** The last account the service confirmed, so the app still opens without a connection. */
const KEY = 'collage.account'
const TIMEOUT_MS = 6000

function readSaved(storage: Storage): Account | null {
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<Account> | null
    if (!value || typeof value.email !== 'string') return null
    return { email: value.email, name: value.name ?? null, picture: value.picture ?? null }
  } catch {
    return null
  }
}

function forget(storage: Storage) {
  try {
    storage.removeItem(KEY)
  } catch (e) {
    console.error(e)
  }
}

/**
 * Asks the service who is signed in. Only a 401 signs the person out: without a connection,
 * or with the service down, the account saved on the device lets them in.
 */
export async function loadAccount(
  fetchFn: typeof fetch = fetch,
  storage: Storage = localStorage,
): Promise<Account | null> {
  // A weak signal must not keep the app blank: past this, it counts as offline.
  // (AbortSignal.timeout only exists from Safari 16.)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await askService(fetchFn, storage, controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

async function askService(
  fetchFn: typeof fetch,
  storage: Storage,
  signal: AbortSignal,
): Promise<Account | null> {
  let response: Response
  try {
    response = await fetchFn('/api/auth/me', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    })
  } catch {
    return readSaved(storage)
  }
  if (response.status === 401) {
    forget(storage)
    return null
  }
  if (!response.ok) return readSaved(storage)
  try {
    const body = (await response.json()) as Partial<Account>
    if (typeof body.email !== 'string') return readSaved(storage)
    const account: Account = {
      email: body.email,
      name: body.name ?? null,
      picture: body.picture ?? null,
    }
    try {
      storage.setItem(KEY, JSON.stringify(account))
    } catch (e) {
      console.error(e)
    }
    return account
  } catch {
    return readSaved(storage)
  }
}

export function signIn(): void {
  location.href = '/api/auth/google/start'
}

/** Ends the session on the service and forgets the account here, even when offline. */
export async function signOut(
  fetchFn: typeof fetch = fetch,
  storage: Storage = localStorage,
): Promise<void> {
  forget(storage)
  try {
    await fetchFn('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  } catch (e) {
    console.error(e)
  }
}
