import { render, screen } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { App } from './App'

describe('App', () => {
  it('opens on the build screen', async () => {
    render(<App />)
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Adicionar primeiro frame' })).toBeVisible()
  })
})
