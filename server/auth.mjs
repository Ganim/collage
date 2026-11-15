// Google sign-in for Collage. Never logs tokens, cookies, codes or environment values.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file'
const YEAR = 365 * 24 * 60 * 60
const ERROR_PAGE = '/#/entrar?erro=1'

const IV_BYTES = 12
const TAG_BYTES = 16

const b64url = (b) => Buffer.from(b).toString('base64url')

/** A failure whose message is fixed text, safe to log (never a token, cookie or value). */
class AuthFailure extends Error {}

const REQUIRED_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'COOKIE_KEY', 'PUBLIC_ORIGIN']

/** The service's settings from the environment. Throws a message naming, never printing, what is wrong. */
export function readConfig(env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name])
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(', ')}`)
  if (Buffer.from(env.COOKIE_KEY, 'base64').length !== 32) {
    throw new Error('COOKIE_KEY must be 32 bytes, base64 encoded')
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    cookieKey: env.COOKIE_KEY,
    publicOrigin: env.PUBLIC_ORIGIN,
  }
}

export function createHandler({ clientId, clientSecret, cookieKey, publicOrigin, fetch }) {
  const key = Buffer.from(cookieKey, 'base64')
  const redirectUri = `${publicOrigin}/api/auth/google/callback`

  function seal(text) {
    const iv = randomBytes(IV_BYTES)
    const c = createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
    return b64url(Buffer.concat([iv, c.getAuthTag(), body]))
  }

  // Throws when the value is malformed or was not sealed with our key.
  function open(sealed) {
    const raw = Buffer.from(sealed, 'base64url')
    if (raw.length < IV_BYTES + TAG_BYTES) throw new AuthFailure('malformed cookie')
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES), {
      authTagLength: TAG_BYTES,
    })
    d.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    return Buffer.concat([d.update(raw.subarray(IV_BYTES + TAG_BYTES)), d.final()]).toString('utf8')
  }

  const cookies = (req) =>
    Object.fromEntries(
      (req.headers.cookie ?? '').split(';').flatMap((p) => {
        const at = p.indexOf('=')
        return at < 0 ? [] : [[p.slice(0, at).trim(), p.slice(at + 1).trim()]]
      }),
    )

  const cookie = (name, value, maxAge) =>
    `${name}=${value}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`

  function redirect(res, location, setCookies = []) {
    res.writeHead(302, { location, 'set-cookie': setCookies, 'cache-control': 'no-store' })
    res.end()
  }

  function start(res) {
    const state = b64url(randomBytes(24))
    const verifier = b64url(randomBytes(48))
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent select_account',
      state,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
    }).toString()
    redirect(res, url.href, [cookie('collage_oauth', seal(`${state} ${verifier}`), 600)])
  }

  async function callback(req, res, url) {
    const [state, verifier] = open(cookies(req).collage_oauth ?? '').split(' ')
    const code = url.searchParams.get('code')
    if (!code || url.searchParams.get('state') !== state) throw new AuthFailure('state mismatch')

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    })
    if (!r.ok) throw new AuthFailure(`token endpoint answered ${r.status}`)
    const { id_token: idToken, refresh_token: newRt } = await r.json()

    // The token came straight from Google over TLS in answer to our own request, so
    // reading its payload without checking the signature is acceptable here.
    const claims = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString())
    if (claims.aud !== clientId) throw new AuthFailure('wrong audience')
    if (claims.email_verified !== true) throw new AuthFailure('email not verified')

    const { sub, email, name, picture } = claims
    // Google may omit the refresh token on a repeat grant: keep ours if it is the same account.
    const previous = readSession(req)
    const keep = newRt ? newRt : previous?.sub === sub ? previous.rt : undefined
    redirect(res, '/#/colecoes', [
      cookie('collage_oauth', '', 0),
      cookie('collage_session', sealSession({ sub, email, name, picture, rt: keep }), YEAR),
    ])
  }

  const sealSession = (s) => seal(JSON.stringify({ ...s, iat: Math.floor(Date.now() / 1000) }))

  // The session in the request, or null when absent, malformed or not sealed with our key.
  function readSession(req) {
    try {
      return JSON.parse(open(cookies(req).collage_session ?? ''))
    } catch {
      return null
    }
  }

  function me(req, res) {
    const headers = { 'cache-control': 'no-store' }
    const session = readSession(req)
    if (!session) {
      res.writeHead(401, headers)
      return res.end()
    }
    const { sub, email, name, picture, rt } = session
    // Sliding renewal: every visit re-seals the session with the current time.
    res.writeHead(200, {
      ...headers,
      'content-type': 'application/json',
      'set-cookie': cookie('collage_session', sealSession({ sub, email, name, picture, rt }), YEAR),
    })
    res.end(JSON.stringify({ id: sub, email, name, picture, drive: Boolean(rt) }))
  }

  // Trades the refresh token kept in the session for a short-lived Drive access token.
  async function driveToken(req, res) {
    const headers = { 'cache-control': 'no-store', 'content-type': 'application/json' }
    const send = (status, body) => {
      res.writeHead(status, headers)
      res.end(JSON.stringify(body))
    }
    const session = readSession(req)
    if (!session) return send(401, { error: 'no_session' })
    if (!session.rt) return send(403, { error: 'no_drive' })

    let r
    let body
    try {
      r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: session.rt,
        }),
      })
      body = await r.json()
    } catch {
      console.error('/api/auth/drive-token', 'token endpoint unreachable or unreadable')
      return send(502, { error: 'google' })
    }
    if (r.status === 400 && body?.error === 'invalid_grant') return send(403, { error: 'revoked' })
    if (!r.ok || typeof body?.access_token !== 'string') {
      console.error('/api/auth/drive-token', `token endpoint answered ${r.status}`)
      return send(502, { error: 'google' })
    }
    send(200, { accessToken: body.access_token, expiresIn: Number(body.expires_in) })
  }

  function logout(res) {
    res.writeHead(204, {
      'set-cookie': cookie('collage_session', '', 0),
      'cache-control': 'no-store',
    })
    res.end()
  }

  return async (req, res) => {
    let url
    try {
      url = new URL(req.url, publicOrigin)
      if (req.method === 'GET' && url.pathname === '/api/auth/google/start') return start(res)
      if (req.method === 'GET' && url.pathname === '/api/auth/google/callback') {
        return await callback(req, res, url)
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/me') return me(req, res)
      if (req.method === 'POST' && url.pathname === '/api/auth/drive-token') {
        return await driveToken(req, res)
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') return logout(res)
      res.writeHead(404)
      res.end()
    } catch (e) {
      // Only fixed text: an error from elsewhere could carry a token or a cookie.
      const reason = e instanceof AuthFailure ? e.message : 'unexpected error'
      console.error(url?.pathname ?? '(bad address)', reason)
      if (url?.pathname.endsWith('/callback')) {
        return redirect(res, ERROR_PAGE, [cookie('collage_oauth', '', 0)])
      }
      res.writeHead(url ? 500 : 400)
      res.end()
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let config
  try {
    config = readConfig(process.env)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
  const server = createServer(createHandler({ ...config, fetch })).listen(8080)
  // The container is stopped with SIGTERM: finish the requests in flight, then leave.
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0))
    server.closeIdleConnections()
  })
}
