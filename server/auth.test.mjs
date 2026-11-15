import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, describe, it, mock } from 'node:test'
import { createHandler } from './auth.mjs'

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

function setup(googleClaims) {
  const googleCalls = []
  const fakeFetch = async (url, init) => {
    googleCalls.push({ url: String(url), body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ id_token: idToken({ aud: CLIENT_ID, ...googleClaims }) }), {
      status: 200,
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

  before(async () => {
    mock.method(console, 'error', () => {})
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
