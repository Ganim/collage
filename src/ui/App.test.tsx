import { render, screen } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { App } from './App'

function serveMe(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })),
  )
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    location.hash = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('without an account, shows the start page with the Google sign-in', async () => {
    serveMe(401)
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Entrar com Google' })).toBeVisible()
  })

  it('with an account, opens on the collections', async () => {
    serveMe(200, { email: 'teste@exemplo.com', name: 'Conta de teste', picture: null })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Nova coleção' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Entrar com Google' })).toBeNull()
  })

  it('a link to a collection that does not exist goes back to the list with a notice', async () => {
    serveMe(200, { email: 'teste@exemplo.com', name: 'Conta de teste', picture: null })
    location.hash = '#/c/nao-existe'
    render(<App />)
    expect(await screen.findByText('Essa coleção não foi encontrada.')).toBeVisible()
    expect(location.hash).toBe('#/colecoes')
    expect(screen.getByRole('button', { name: 'Nova coleção' })).toBeVisible()
  })
})
