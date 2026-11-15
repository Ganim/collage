import type { Plugin } from 'vite'

const COOKIE = 'collage_session'
const PROFILE = { email: 'teste@exemplo.com', name: 'Conta de teste', picture: null }

// Stands in for the collage-auth service in `npm run dev`: same routes, fake account.
export function authMock(): Plugin {
  return {
    name: 'collage-auth-mock',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        const signedIn = (req.headers.cookie ?? '').split(';').some((c) => c.trim() === `${COOKIE}=dev`)

        if (req.method === 'GET' && path === '/api/auth/google/start') {
          res.writeHead(302, { location: '/api/auth/google/callback' })
          return res.end()
        }
        if (req.method === 'GET' && path === '/api/auth/google/callback') {
          res.writeHead(302, {
            location: '/#/colecoes',
            'set-cookie': `${COOKIE}=dev; Path=/api; HttpOnly; SameSite=Lax; Max-Age=31536000`,
          })
          return res.end()
        }
        if (req.method === 'GET' && path === '/api/auth/me') {
          res.setHeader('cache-control', 'no-store')
          if (!signedIn) {
            res.statusCode = 401
            return res.end()
          }
          res.setHeader('content-type', 'application/json')
          return res.end(JSON.stringify(PROFILE))
        }
        if (req.method === 'POST' && path === '/api/auth/logout') {
          res.writeHead(204, { 'set-cookie': `${COOKIE}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0` })
          return res.end()
        }
        next()
      })
    },
  }
}
