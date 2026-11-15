import { fireEvent, render, screen } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { App } from './App'

function serveMe(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })),
  )
}

const originalShowModal = HTMLDialogElement.prototype.showModal as
  HTMLDialogElement['showModal'] | undefined

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    location.hash = ''
    // jsdom has no modal dialogs (restored after each test).
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalShowModal) HTMLDialogElement.prototype.showModal = originalShowModal
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal
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
    expect(await screen.findByRole('button', { name: 'Nova coleção' })).toBeVisible()
  })
  it('without Drive access, the cloud says so and the menu offers to connect', async () => {
    serveMe(200, {
      id: 'u1',
      email: 'teste@exemplo.com',
      name: 'Conta',
      picture: null,
      drive: false,
    })
    render(<App />)
    const badge = await screen.findByRole('button', { name: 'Só neste aparelho' })
    fireEvent.click(badge)
    expect(
      await screen.findByRole('button', { name: 'Conectar ao Google Drive para sincronizar' }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Sincronizar agora' })).toBeNull()
  })

  it('offers once, on the collections, to connect the Drive', async () => {
    const account = {
      id: 'u1',
      email: 'teste@exemplo.com',
      name: 'Conta',
      picture: null,
      drive: false,
    }
    serveMe(200, account)
    const first = render(<App />)
    const prompt = await screen.findByRole('dialog', {
      name: 'Conectar ao Google Drive para sincronizar',
    })
    expect(prompt).toHaveTextContent(
      'Assim suas coleções ficam guardadas também no seu Google Drive e aparecem nos outros aparelhos.',
    )
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(
      screen.queryByRole('dialog', { name: 'Conectar ao Google Drive para sincronizar' }),
    ).toBeNull()
    first.unmount()

    // Opening the app again on this device does not ask again; the menu still offers it.
    serveMe(200, account)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Só neste aparelho' }))
    expect(
      await screen.findByRole('button', { name: 'Conectar ao Google Drive para sincronizar' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('dialog', { name: 'Conectar ao Google Drive para sincronizar' }),
    ).toBeNull()
  })

  it('does not offer to connect when the Drive is already connected', async () => {
    serveMe(200, {
      id: 'u1',
      email: 'teste@exemplo.com',
      name: 'Conta',
      picture: null,
      drive: true,
    })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Nova coleção' })).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
