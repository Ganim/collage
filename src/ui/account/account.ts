export interface Account {
  /** The Google account's stable id (`sub`). */
  id: string
  email: string
  name: string | null
  picture: string | null
  /** Whether this sign-in granted access to the Drive folder the app syncs to. */
  drive: boolean
}

/**
 * Whether the id is only the e-mail standing in for an account saved before ids existed, until
 * the service answers. Google's ids are digits, never an e-mail.
 */
export function hasProvisionalId(account: Pick<Account, 'id' | 'email'>): boolean {
  return account.id === account.email
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
    // Accounts saved before ids and Drive existed: id = email, no Drive, until the service answers.
    return {
      id: typeof value.id === 'string' ? value.id : value.email,
      email: value.email,
      name: value.name ?? null,
      picture: value.picture ?? null,
      drive: value.drive === true,
    }
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
      id: typeof body.id === 'string' ? body.id : body.email,
      email: body.email,
      name: body.name ?? null,
      picture: body.picture ?? null,
      drive: body.drive === true,
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
  clearDriveToken()
  try {
    await fetchFn('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  } catch (e) {
    console.error(e)
  }
}

export type DriveAuthReason = 'no_drive' | 'revoked' | 'signed_out'

/** The person cannot use Drive right now and only they can fix it (sign in, grant, reconnect). */
export class DriveAuthError extends Error {
  constructor(readonly reason: DriveAuthReason) {
    super(`Drive access unavailable: ${reason}`)
    this.name = 'DriveAuthError'
  }
}

export interface DriveToken {
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt: number
}

/** A cached token is dropped this long before it expires, so a request never starts with a dying one. */
const EXPIRY_MARGIN_MS = 60_000

/** The service could not be reached to ask for a Drive token: the device is offline. */
export class DriveNetworkError extends Error {
  constructor() {
    super('No connection to the Drive token service')
    this.name = 'DriveNetworkError'
  }
}

let driveToken: DriveToken | null = null
/** The request every caller shares while it runs. */
let inFlight: Promise<DriveToken> | null = null
/** Bumped by each new request and by clearDriveToken: only the latest request fills the cache. */
let generation = 0

/** Forgets the cached Drive token (sign out, or a Drive call that said it was refused). */
export function clearDriveToken(): void {
  driveToken = null
  inFlight = null
  generation++
}

/**
 * A short-lived Drive access token from the service, kept in memory only. Throws
 * {@link DriveAuthError} when the person must act, {@link DriveNetworkError} when the service
 * cannot be reached, and a plain Error for anything else (Google down).
 * Concurrent calls share one request. `force` skips the cache and starts a new request, which
 * the calls after it share instead.
 */
export function getDriveToken(fetchFn: typeof fetch = fetch, force = false): Promise<DriveToken> {
  if (!force && driveToken && driveToken.expiresAt - EXPIRY_MARGIN_MS > Date.now())
    return Promise.resolve(driveToken)
  if (!force && inFlight) return inFlight
  const mine = ++generation
  const request = requestDriveToken(fetchFn).then(
    (token) => {
      if (generation === mine) {
        driveToken = token
        inFlight = null
      }
      return token
    },
    (e: unknown) => {
      if (generation === mine) inFlight = null
      throw e
    },
  )
  inFlight = request
  return request
}

async function requestDriveToken(fetchFn: typeof fetch): Promise<DriveToken> {
  let response: Response
  try {
    response = await fetchFn('/api/auth/drive-token', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
    })
  } catch {
    throw new DriveNetworkError()
  }
  if (response.status === 401) throw new DriveAuthError('signed_out')
  if (response.status === 403) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null
    if (body?.error === 'no_drive') throw new DriveAuthError('no_drive')
    if (body?.error === 'revoked') throw new DriveAuthError('revoked')
    throw new Error('Drive token request refused')
  }
  if (!response.ok) throw new Error(`Drive token request failed (${response.status})`)
  const body = (await response.json()) as { accessToken?: unknown; expiresIn?: unknown }
  if (typeof body.accessToken !== 'string' || typeof body.expiresIn !== 'number') {
    throw new Error('Drive token response malformed')
  }
  return { accessToken: body.accessToken, expiresAt: Date.now() + body.expiresIn * 1000 }
}
