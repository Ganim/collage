import assert from 'node:assert/strict'
import { createCipheriv, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, before, describe, it, mock } from 'node:test'
import { createHandler, readConfig } from './auth.mjs'

const CLIENT_ID = 'client-123.apps.googleusercontent.com'
const ORIGIN = 'https://collage.example.test'

const idToken = (claims) =>
  ['{"alg":"RS256"}', JSON.stringify(claims), 'sig']
    .map((p) => Buffer.from(p).toString('base64url'))
    .join('.')

// The scope string Google answers with when every permission was granted.
const GRANTED_ALL =
  'openid https://www.googleapis.com/auth/userinfo.email ' +
  'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/drive.file'

const profile = {
  sub: '42',
  email: 'ana@example.com',
  email_verified: true,
  name: 'Ana',
  picture: 'https://example.com/ana.png',
}

function setup(
  googleClaims,
  {
    tokenStatus = 200,
    tokenError,
    refreshToken,
    refreshStatus = 200,
    refreshBody,
    scope = GRANTED_ALL,
  } = {},
) {
  const googleCalls = []
  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  const fakeFetch = async (url, init) => {
    const body = String(init?.body ?? '')
    googleCalls.push({ url: String(url), body })
    if (tokenError) throw tokenError
    if (body.includes('grant_type=refresh_token')) {
      return json(refreshStatus, refreshBody ?? { access_token: 'access-1', expires_in: 3599 })
    }
    return json(tokenStatus, {
      id_token: idToken({ aud: CLIENT_ID, ...googleClaims }),
      ...(scope ? { scope } : {}),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    })
  }
  const handler = createHandler({
    clientId: CLIENT_ID,
    clientSecret: 'secret',
    cookieKey: Buffer.alloc(32, 7).toString('base64'),
    publicOrigin: ORIGIN,
    fetch: fakeFetch,
  })
  return { handler, googleCalls }
}

describe('collage auth', () => {
  let server
  let base
  let current

  let logged

  before(async () => {
    logged = mock.method(console, 'error', () => {})
    server = createServer((req, res) => current.handler(req, res))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${server.address().port}`
  })
  after(() => server.close())

  const call = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init })
  const cookiePair = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))
  const pairOnly = (setCookie) => setCookie.split(';')[0]

  async function startFlow() {
    const res = await call('/api/auth/google/start')
    const location = new URL(res.headers.get('location'))
    return { res, location, oauth: pairOnly(cookiePair(res, 'collage_oauth')) }
  }

  it('start sets a sealed oauth cookie and redirects to Google with PKCE', async () => {
    current = setup(profile)
    const { res, location } = await startFlow()
    assert.equal(res.status, 302)
    assert.equal(
      location.origin + location.pathname,
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    const q = location.searchParams
    assert.equal(q.get('client_id'), CLIENT_ID)
    assert.equal(q.get('redirect_uri'), `${ORIGIN}/api/auth/google/callback`)
    assert.equal(q.get('scope'), 'openid email profile https://www.googleapis.com/auth/drive.file')
    assert.equal(q.get('access_type'), 'offline')
    assert.equal(q.get('prompt'), 'consent select_account')
    assert.equal(q.get('code_challenge_method'), 'S256')
    assert.ok(q.get('code_challenge'))
    assert.ok(q.get('state'))
    const set = cookiePair(res, 'collage_oauth')
    assert.match(set, /Path=\/api/)
    assert.match(set, /HttpOnly/)
    assert.match(set, /Secure/)
    assert.match(set, /SameSite=Lax/)
    assert.match(set, /Max-Age=600/)
    assert.ok(!set.includes(q.get('state')), 'cookie value must be sealed')
  })

  it('callback with a wrong state redirects to the error page', async () => {
    current = setup(profile)
    const { oauth } = await startFlow()
    const res = await call('/api/auth/google/callback?code=abc&state=wrong', {
      headers: { cookie: oauth },
    })
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), '/#/entrar?erro=1')
    assert.equal(current.googleCalls.length, 0)
  })

  it('callback stores the profile and me returns it', async () => {
    current = setup(profile)
    const { location, oauth } = await startFlow()
    const state = location.searchParams.get('state')
    const res = await call(`/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie: oauth },
    })
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), '/#/colecoes')
    const session = cookiePair(res, 'collage_session')
    assert.match(session, /Path=\/api/)
    assert.match(session, /HttpOnly/)
    assert.match(session, /Secure/)
    assert.match(session, /SameSite=Lax/)
    assert.match(session, new RegExp(`Max-Age=${365 * 24 * 60 * 60}`))
    assert.match(current.googleCalls[0].body, /code_verifier=/)

    const me = await call('/api/auth/me', { headers: { cookie: pairOnly(session) } })
    assert.equal(me.status, 200)
    assert.equal(me.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await me.json(), {
      id: '42',
      email: 'ana@example.com',
      name: 'Ana',
      picture: 'https://example.com/ana.png',
      drive: false,
    })
  })

  it('callback rejects an id_token for another client', async () => {
    current = setup({ ...profile, aud: 'someone-else' })
    const { location, oauth } = await startFlow()
    const state = location.searchParams.get('state')
    const res = await call(`/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie: oauth },
    })
    assert.equal(res.headers.get('location'), '/#/entrar?erro=1')
    assert.equal(cookiePair(res, 'collage_session'), undefined)
  })

  async function callbackWith(claims, options) {
    current = setup(claims, options)
    const { location, oauth } = await startFlow()
    const state = location.searchParams.get('state')
    return call(`/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie: oauth },
    })
  }

  function assertSignInFailed(res) {
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), '/#/entrar?erro=1')
    assert.equal(cookiePair(res, 'collage_session'), undefined)
    assert.match(cookiePair(res, 'collage_oauth'), /Max-Age=0/)
  }

  it('callback refuses an e-mail Google has not verified', async () => {
    assertSignInFailed(await callbackWith({ ...profile, email_verified: false }))
  })

  it('callback without the oauth cookie fails without asking Google', async () => {
    current = setup(profile)
    const res = await call('/api/auth/google/callback?code=abc&state=anything')
    assertSignInFailed(res)
    assert.equal(current.googleCalls.length, 0)
  })

  it('callback fails when the token endpoint does not answer 200', async () => {
    assertSignInFailed(await callbackWith(profile, { tokenStatus: 400 }))
  })

  it('callback with a wrong state also clears the oauth cookie', async () => {
    current = setup(profile)
    const { oauth } = await startFlow()
    const res = await call('/api/auth/google/callback?code=abc&state=wrong', {
      headers: { cookie: oauth },
    })
    assertSignInFailed(res)
  })

  it('logs a fixed reason, never the error text', async () => {
    logged.mock.resetCalls()
    const tokenError = new Error('leaked-secret-value')
    assertSignInFailed(await callbackWith(profile, { tokenError }))
    const lines = logged.mock.calls.map((c) => c.arguments.map(String).join(' '))
    assert.ok(lines.length > 0)
    for (const line of lines) assert.ok(!line.includes('leaked-secret-value'), line)
  })

  it('me with a cookie too short to hold a tag is 401', async () => {
    current = setup(profile)
    const short = Buffer.alloc(20, 1).toString('base64url')
    const me = await call('/api/auth/me', { headers: { cookie: `collage_session=${short}` } })
    assert.equal(me.status, 401)
  })

  it('callback with a short oauth cookie fails', async () => {
    current = setup(profile)
    const short = Buffer.alloc(20, 1).toString('base64url')
    const res = await call('/api/auth/google/callback?code=abc&state=x', {
      headers: { cookie: `collage_oauth=${short}` },
    })
    assertSignInFailed(res)
    assert.equal(current.googleCalls.length, 0)
  })

  it('me without a cookie is 401', async () => {
    current = setup(profile)
    const res = await call('/api/auth/me')
    assert.equal(res.status, 401)
    assert.equal(res.headers.get('cache-control'), 'no-store')
  })

  it('me with a tampered cookie is 401', async () => {
    current = setup(profile)
    const { location, oauth } = await startFlow()
    const state = location.searchParams.get('state')
    const cb = await call(`/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie: oauth },
    })
    const value = pairOnly(cookiePair(cb, 'collage_session')).split('=')[1]
    const flipped = value.slice(0, -2) + (value.endsWith('AA') ? 'BB' : 'AA')
    const me = await call('/api/auth/me', { headers: { cookie: `collage_session=${flipped}` } })
    assert.equal(me.status, 401)
  })

  it('logout clears the session cookie', async () => {
    current = setup(profile)
    const res = await call('/api/auth/logout', { method: 'POST' })
    assert.equal(res.status, 204)
    const set = cookiePair(res, 'collage_session')
    assert.match(set, /Max-Age=0/)
    assert.match(set, /Path=\/api/)
  })
})

describe('collage auth: Drive access', () => {
  let server
  let base
  let current
  let logged

  before(async () => {
    logged = mock.method(console, 'error', () => {})
    server = createServer((req, res) => current.handler(req, res))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${server.address().port}`
  })
  after(() => server.close())

  const call = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init })
  const sessionPair = (res) =>
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith('collage_session='))
      ?.split(';')[0]

  // Runs the whole sign-in and returns the session cookie pair.
  async function signIn(options, claims = profile, cookie) {
    current = setup(claims, options)
    const start = await call('/api/auth/google/start')
    const state = new URL(start.headers.get('location')).searchParams.get('state')
    const oauth = start.headers
      .getSetCookie()
      .find((c) => c.startsWith('collage_oauth='))
      .split(';')[0]
    const res = await call(`/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie: cookie ? `${oauth}; ${cookie}` : oauth },
    })
    return sessionPair(res)
  }

  const driveToken = (session) =>
    call('/api/auth/drive-token', {
      method: 'POST',
      headers: session ? { cookie: session } : {},
    })

  it('callback keeps the refresh token in the session and me reports drive: true', async () => {
    const session = await signIn({ refreshToken: 'rt-secret' })
    const me = await call('/api/auth/me', { headers: { cookie: session } })
    const body = await me.json()
    assert.equal(body.drive, true)
    assert.equal(body.id, '42')
    assert.ok(!JSON.stringify(body).includes('rt-secret'))
    assert.ok(!session.includes('rt-secret'), 'cookie must be sealed')
  })

  it('callback keeps the old refresh token when Google sends none for the same account', async () => {
    const first = await signIn({ refreshToken: 'rt-old' })
    const second = await signIn({}, profile, first)
    const res = await driveToken(second)
    assert.equal(res.status, 200)
    assert.equal(
      new URLSearchParams(current.googleCalls.at(-1).body).get('refresh_token'),
      'rt-old',
    )
  })

  it('callback does not carry the old refresh token over to another account', async () => {
    const first = await signIn({ refreshToken: 'rt-old' })
    const second = await signIn({}, { ...profile, sub: '99' }, first)
    const me = await call('/api/auth/me', { headers: { cookie: second } })
    assert.equal((await me.json()).drive, false)
  })

  it('callback drops the refresh token when Drive was left unchecked', async () => {
    const session = await signIn({
      refreshToken: 'rt-secret',
      scope: 'openid https://www.googleapis.com/auth/userinfo.email',
    })
    const me = await call('/api/auth/me', { headers: { cookie: session } })
    assert.equal((await me.json()).drive, false)
    const res = await driveToken(session)
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'no_drive' })
  })

  it('callback does not keep the old refresh token when Drive is now unchecked', async () => {
    const first = await signIn({ refreshToken: 'rt-old' })
    const second = await signIn({ scope: 'openid email profile' }, profile, first)
    const me = await call('/api/auth/me', { headers: { cookie: second } })
    assert.equal((await me.json()).drive, false)
  })

  it('callback with no scope in the answer keeps no Drive access', async () => {
    const session = await signIn({ refreshToken: 'rt-secret', scope: null })
    const me = await call('/api/auth/me', { headers: { cookie: session } })
    assert.equal((await me.json()).drive, false)
  })

  it('me renews the cookie with a year of life', async () => {
    const session = await signIn({ refreshToken: 'rt-secret' })
    const me = await call('/api/auth/me', { headers: { cookie: session } })
    const set = me.headers.getSetCookie().find((c) => c.startsWith('collage_session='))
    assert.match(set, new RegExp(`Max-Age=${365 * 24 * 60 * 60}`))
    assert.match(set, /HttpOnly/)
    assert.match(set, /Secure/)
    const again = await call('/api/auth/me', { headers: { cookie: set.split(';')[0] } })
    assert.equal((await again.json()).drive, true)
  })

  it('me still accepts a session sealed before Drive access existed', async () => {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', Buffer.alloc(32, 7), iv)
    const text = JSON.stringify({ sub: '42', email: 'ana@example.com', name: 'Ana', picture: null })
    const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
    const old = Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url')
    current = setup(profile)
    const me = await call('/api/auth/me', { headers: { cookie: `collage_session=${old}` } })
    assert.equal(me.status, 200)
    assert.deepEqual(await me.json(), {
      id: '42',
      email: 'ana@example.com',
      name: 'Ana',
      picture: null,
      drive: false,
    })
    assert.ok(me.headers.getSetCookie().some((s) => s.startsWith('collage_session=')))
  })

  it('drive-token exchanges the refresh token for an access token', async () => {
    const session = await signIn({ refreshToken: 'rt-secret' })
    const res = await driveToken(session)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await res.json(), { accessToken: 'access-1', expiresIn: 3599 })
    const sent = current.googleCalls.at(-1)
    assert.equal(sent.url, 'https://oauth2.googleapis.com/token')
    const form = new URLSearchParams(sent.body)
    assert.equal(form.get('grant_type'), 'refresh_token')
    assert.equal(form.get('refresh_token'), 'rt-secret')
    assert.equal(form.get('client_id'), CLIENT_ID)
    assert.equal(form.get('client_secret'), 'secret')
  })

  it('drive-token falls back to an hour when Google sends no usable expires_in', async () => {
    const session = await signIn({
      refreshToken: 'rt-secret',
      refreshBody: { access_token: 'access-2' },
    })
    const res = await driveToken(session)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { accessToken: 'access-2', expiresIn: 3600 })
  })

  it('drive-token without a cookie is 401', async () => {
    current = setup(profile)
    assert.equal((await driveToken()).status, 401)
  })

  it('drive-token without a refresh token is 403 no_drive', async () => {
    const session = await signIn({})
    const res = await driveToken(session)
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'no_drive' })
  })

  it('drive-token answers 403 revoked when Google says invalid_grant', async () => {
    const session = await signIn({
      refreshToken: 'rt-secret',
      refreshStatus: 400,
      refreshBody: { error: 'invalid_grant' },
    })
    const res = await driveToken(session)
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'revoked' })
  })

  it('drive-token answers 502 for any other Google failure', async () => {
    const session = await signIn({
      refreshToken: 'rt-secret',
      refreshStatus: 500,
      refreshBody: { error: 'backend_error' },
    })
    assert.equal((await driveToken(session)).status, 502)
  })

  it('never logs a token', async () => {
    logged.mock.resetCalls()
    const revoked = await signIn({
      refreshToken: 'rt-secret',
      refreshStatus: 400,
      refreshBody: { error: 'invalid_grant', error_description: 'rt-secret access-1' },
    })
    await driveToken(revoked)
    const failing = await signIn({
      refreshToken: 'rt-secret',
      refreshStatus: 500,
      refreshBody: { error: 'rt-secret access-1' },
    })
    await driveToken(failing)
    assert.ok(logged.mock.calls.length > 0)
    for (const c of logged.mock.calls) {
      const line = c.arguments.map(String).join(' ')
      assert.ok(!line.includes('rt-secret') && !line.includes('access-1'), line)
    }
  })
})

describe('readConfig', () => {
  const env = {
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'secret-value',
    COOKIE_KEY: Buffer.alloc(32, 7).toString('base64'),
    PUBLIC_ORIGIN: ORIGIN,
  }

  it('reads a complete environment', () => {
    assert.deepEqual(readConfig(env), {
      clientId: CLIENT_ID,
      clientSecret: 'secret-value',
      cookieKey: env.COOKIE_KEY,
      publicOrigin: ORIGIN,
    })
  })

  it('names the missing variables without printing any value', () => {
    assert.throws(
      () => readConfig({ ...env, GOOGLE_CLIENT_SECRET: '', PUBLIC_ORIGIN: undefined }),
      (e) =>
        e.message.includes('GOOGLE_CLIENT_SECRET') &&
        e.message.includes('PUBLIC_ORIGIN') &&
        !e.message.includes('secret-value') &&
        !e.message.includes(CLIENT_ID),
    )
  })

  it('refuses a COOKIE_KEY that is not 32 bytes', () => {
    const shortKey = Buffer.alloc(16, 7).toString('base64')
    assert.throws(
      () => readConfig({ ...env, COOKIE_KEY: shortKey }),
      (e) => e.message.includes('COOKIE_KEY') && !e.message.includes(shortKey),
    )
  })
})
