import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, describe, it, mock } from 'node:test'
import { createHandler, readConfig } from './auth.mjs'

const CLIENT_ID = 'client-123.apps.googleusercontent.com'
const ORIGIN = 'https://collage.example.test'

const idToken = (claims) =>
  ['{"alg":"RS256"}', JSON.stringify(claims), 'sig']
    .map((p) => Buffer.from(p).toString('base64url'))
    .join('.')

const profile = {
  sub: '42',
  email: 'ana@example.com',
  email_verified: true,
  name: 'Ana',
  picture: 'https://example.com/ana.png',
}

function setup(googleClaims, { tokenStatus = 200, tokenError } = {}) {
  const googleCalls = []
  const fakeFetch = async (url, init) => {
    googleCalls.push({ url: String(url), body: String(init?.body ?? '') })
    if (tokenError) throw tokenError
    return new Response(JSON.stringify({ id_token: idToken({ aud: CLIENT_ID, ...googleClaims }) }), {
      status: tokenStatus,
      headers: { 'content-type': 'application/json' },
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
  const cookiePair = (res, name) =>
    res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))
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
    assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
    const q = location.searchParams
    assert.equal(q.get('client_id'), CLIENT_ID)
    assert.equal(q.get('redirect_uri'), `${ORIGIN}/api/auth/google/callback`)
    assert.equal(q.get('scope'), 'openid email profile')
    assert.equal(q.get('prompt'), 'select_account')
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
      email: 'ana@example.com',
      name: 'Ana',
      picture: 'https://example.com/ana.png',
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
