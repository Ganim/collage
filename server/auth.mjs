// Google sign-in for Collage. Never logs tokens, cookies, codes or environment values.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const SCOPES = 'openid email profile'
const YEAR = 365 * 24 * 60 * 60
const ERROR_PAGE = '/#/entrar?erro=1'

const b64url = (b) => Buffer.from(b).toString('base64url')

export function createHandler({ clientId, clientSecret, cookieKey, publicOrigin, fetch }) {
  const key = Buffer.from(cookieKey, 'base64')
  const redirectUri = `${publicOrigin}/api/auth/google/callback`

  function seal(text) {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
    return b64url(Buffer.concat([iv, c.getAuthTag(), body]))
  }

  // Throws when the value is malformed or was not sealed with our key.
  function open(sealed) {
    const raw = Buffer.from(sealed, 'base64url')
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
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
      prompt: 'select_account',
      state,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
    }).toString()
    redirect(res, url.href, [cookie('collage_oauth', seal(`${state} ${verifier}`), 600)])
  }

  async function callback(req, res, url) {
    const [state, verifier] = open(cookies(req).collage_oauth ?? '').split(' ')
    const code = url.searchParams.get('code')
    if (!code || url.searchParams.get('state') !== state) throw new Error('state mismatch')

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
    if (!r.ok) throw new Error(`token endpoint ${r.status}`)
    const { id_token: idToken } = await r.json()

    // The token came straight from Google over TLS in answer to our own request, so
    // reading its payload without checking the signature is acceptable here.
    const claims = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString())
    if (claims.aud !== clientId) throw new Error('wrong audience')
    if (claims.email_verified !== true) throw new Error('email not verified')

    const { sub, email, name, picture } = claims
    redirect(res, '/#/colecoes', [
      cookie('collage_oauth', '', 0),
      cookie('collage_session', seal(JSON.stringify({ sub, email, name, picture })), YEAR),
    ])
  }

  function me(req, res) {
    const headers = { 'cache-control': 'no-store' }
    try {
      const { email, name, picture } = JSON.parse(open(cookies(req).collage_session ?? ''))
      res.writeHead(200, { ...headers, 'content-type': 'application/json' })
      res.end(JSON.stringify({ email, name, picture }))
    } catch {
      res.writeHead(401, headers)
      res.end()
    }
  }

  function logout(res) {
    res.writeHead(204, {
      'set-cookie': cookie('collage_session', '', 0),
      'cache-control': 'no-store',
    })
    res.end()
  }

  return async (req, res) => {
    const url = new URL(req.url, publicOrigin)
    try {
      if (req.method === 'GET' && url.pathname === '/api/auth/google/start') return start(res)
      if (req.method === 'GET' && url.pathname === '/api/auth/google/callback') {
        return await callback(req, res, url)
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/me') return me(req, res)
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') return logout(res)
      res.writeHead(404)
      res.end()
    } catch (e) {
      console.error(url.pathname, e.message)
      if (url.pathname.endsWith('/callback')) return redirect(res, ERROR_PAGE)
      res.writeHead(500)
      res.end()
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, COOKIE_KEY, PUBLIC_ORIGIN } = process.env
  createServer(
    createHandler({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      cookieKey: COOKIE_KEY,
      publicOrigin: PUBLIC_ORIGIN,
      fetch,
    }),
  ).listen(8080)
}
