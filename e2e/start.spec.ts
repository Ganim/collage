import { expect } from '@playwright/test'
import { test } from './helpers'

const signIn = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Entrar com Google', exact: true })

test.describe('without an account', () => {
  test.use({ loggedIn: false })

  test('shows the three steps and the Google button', async ({ page }) => {
    await page.goto('/')
    for (const step of [
      'Monte suas fotos no tamanho do porta-retrato',
      'Ajuste com os dedos',
      'Imprima no tamanho exato',
    ]) {
      await expect(page.getByRole('heading', { name: step })).toBeAttached()
    }
    await expect(signIn(page)).toBeVisible()
    await expect(page.getByText('Suas fotos ficam no seu aparelho.')).toBeVisible()
    await expect(page.getByText('Não foi possível entrar. Tente de novo.')).toHaveCount(0)
  })

  test('the dots follow the steps', async ({ page }) => {
    await page.goto('/')
    const third = page.getByRole('button', { name: 'Ir para o passo 3', exact: true })
    await third.click()
    await expect(third).toHaveAttribute('aria-current', 'step')
    await expect(page.getByRole('heading', { name: 'Imprima no tamanho exato' })).toBeInViewport()
  })

  test('a failed sign-in says so', async ({ page }) => {
    await page.goto('/#/entrar?erro=1')
    await expect(page.getByText('Não foi possível entrar. Tente de novo.')).toBeVisible()
    await expect(signIn(page)).toBeVisible()
  })

  test('the button goes to the Google sign-in', async ({ page, context }) => {
    await context.route('**/api/auth/google/start', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: '<p>google</p>' }),
    )
    await page.goto('/')
    await signIn(page).click()
    await expect(page).toHaveURL(/\/api\/auth\/google\/start$/)
  })
})

test('offline keeps the account', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Nova coleção', exact: true })).toBeVisible()
  await context.route('**/api/auth/me', (r) => r.abort())
  await page.reload()
  await expect(page.getByRole('button', { name: 'Nova coleção', exact: true })).toBeVisible()
  await expect(signIn(page)).toHaveCount(0)
})
