import { expect, type Page } from '@playwright/test'
import {
  addFrame,
  frameLabel,
  frameWithPhoto,
  goHome,
  nameOpenCollection,
  openNewCollection,
  savedCollection,
  serveAccount,
  test,
  workChip,
} from './helpers'

const more = (page: Page) => page.getByRole('button', { name: 'Mais opções', exact: true })
const menuItem = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

test.beforeEach(async ({ page, installHint }) => {
  // The install suggestion covers the list, so those tests start under it.
  if (installHint) await page.goto('/#/colecoes')
  else await openNewCollection(page)
})

test('the menu lists collections, saving, sizes and the frame actions', async ({ page }) => {
  await frameWithPhoto(page)
  await more(page).click()
  for (const name of [
    'Coleções',
    'Salvar em arquivo',
    'Meus tamanhos',
    'Duplicar frame',
    'Remover frame',
  ]) {
    await expect(menuItem(page, name)).toBeVisible()
  }
})

test('the menu leaves out the frame actions when there is no frame', async ({ page }) => {
  await more(page).click()
  await expect(menuItem(page, 'Coleções')).toBeVisible()
  await expect(menuItem(page, 'Duplicar frame')).toHaveCount(0)
  await expect(menuItem(page, 'Remover frame')).toHaveCount(0)
})

test('the menu row goes back to the list', async ({ page }) => {
  await more(page).click()
  await menuItem(page, 'Coleções').click()
  await expect(page).toHaveURL(/#\/colecoes$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Coleções' })).toBeVisible()
})

test('duplicating a frame copies its photos', async ({ page }) => {
  await frameWithPhoto(page)
  await more(page).click()
  await menuItem(page, 'Duplicar frame').click()
  await expect(frameLabel(page, 'Frame 2 de 2').locator('img')).toHaveCount(1)
})

test('removing a frame takes a second tap', async ({ page }) => {
  await frameWithPhoto(page)
  await more(page).click()
  await menuItem(page, 'Remover frame').click()
  await expect(frameLabel(page, 'Frame 1 de 1')).toBeAttached()
  await menuItem(page, 'Confirmar remoção do frame').click()
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
})

test('the menu row Meus tamanhos opens the sizes, with the one just saved', async ({ page }) => {
  await page.getByRole('button', { name: 'Adicionar primeiro frame', exact: true }).click()
  await page.getByLabel('Largura (cm)').fill('9')
  await page.getByLabel('Altura (cm)').fill('12')
  await page.getByLabel('Nome (opcional)').fill('Mesa da sala')
  await page.getByRole('button', { name: 'Usar este tamanho', exact: true }).click()

  await more(page).click()
  await menuItem(page, 'Meus tamanhos').click()
  await expect(page).toHaveURL(/#\/frames$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const mine = page.getByRole('link', { name: 'Meus tamanhos', exact: true })
  await expect(mine).toHaveAccessibleDescription('1 tamanho')
  await mine.click()
  await expect(page.getByText('Mesa da sala')).toBeVisible()
})

test('a second collection leaves the first one as it was', async ({ page }) => {
  await frameWithPhoto(page)
  await nameOpenCollection(page, 'Maio')
  await page.getByRole('button', { name: 'Baixar', exact: true }).click()
  const summary = page.getByText(/^\d+ folhas? · \d+%$/)
  await expect(summary).toBeVisible()
  const before = await summary.textContent()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()

  await goHome(page)
  await menuItem(page, 'Nova coleção').click()
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
  await addFrame(page, '13×18 cm')
  await addFrame(page, '13×18 cm')
  await expect(frameLabel(page, 'Frame 2 de 2')).toBeVisible()
  await nameOpenCollection(page, 'Junho')

  await goHome(page)
  await menuItem(page, 'Maio').click()
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
  await page.getByRole('button', { name: 'Baixar', exact: true }).click()
  await expect(summary).toHaveText(before!)
})

// The service worker never became ready in the persistent profile the other tests need for Blobs.
test('after the first visit the app loads offline', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  await serveAccount(context)
  const page = await context.newPage()
  await page.goto('/')
  const newCollection = page.getByRole('button', { name: 'Nova coleção', exact: true })
  await expect(newCollection).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })

  await context.setOffline(true)
  await page.reload()
  await expect(newCollection).toBeVisible()
  await context.close()
})

test('the top bar names the open work and one tap lists the others', async ({ page }) => {
  await frameWithPhoto(page)
  await nameOpenCollection(page, 'Maio')
  await expect(workChip(page)).toHaveText('Maio')
  await goHome(page)
  await menuItem(page, 'Nova coleção').click()
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()

  await goHome(page)
  await menuItem(page, 'Maio').click()
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
  await expect(workChip(page)).toHaveText('Maio')
})

test('a very long name keeps the top bar and the frame in place', async ({ page }) => {
  await frameWithPhoto(page)
  await nameOpenCollection(page, 'Maio')
  const frame = frameLabel(page, 'Frame 1 de 1')
  const before = (await frame.boundingBox())!

  await nameOpenCollection(page, 'Muito longo '.repeat(20))
  await expect(page.getByRole('button', { name: 'Baixar', exact: true })).toBeInViewport({
    ratio: 1,
  })
  const chip = (await workChip(page).boundingBox())!
  expect(chip.x + chip.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  expect(await frame.boundingBox()).toEqual(before)
})

test('closing the app and opening it again brings the work back', async ({ page, context }) => {
  await frameWithPhoto(page)
  await expect.poll(async () => (await savedCollection(page))?.frames.length).toBe(1)
  const address = page.url()
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto(address)
  await expect(frameLabel(reopened, 'Frame 1 de 1').locator('img')).toHaveCount(1)
})

test('a failure reading the saved work offers a retry and loses nothing', async ({
  page,
  context,
}) => {
  await frameWithPhoto(page)
  await expect.poll(async () => (await savedCollection(page))?.frames.length).toBe(1)
  await context.addInitScript(() => {
    // On the prototype: WebKit can hand the page a different factory than this script saw.
    const open = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (...args: Parameters<typeof open>) {
      if (sessionStorage.getItem('failReads')) throw new Error('cannot read')
      return open.apply(this, args)
    }
  })
  await page.evaluate(() => sessionStorage.setItem('failReads', '1'))

  await page.reload()
  await expect(page.getByRole('alert')).toHaveText(/Não foi possível abrir seus trabalhos\./)
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toHaveCount(0)

  await page.evaluate(() => sessionStorage.removeItem('failReads'))
  await page.getByRole('button', { name: 'Tentar de novo', exact: true }).click()
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
})

test('when the open work cannot be read, the others can still be opened', async ({
  page,
  context,
}) => {
  await frameWithPhoto(page)
  await nameOpenCollection(page, 'Maio')
  await expect.poll(async () => (await savedCollection(page))?.name).toBe('Maio')
  await openNewCollection(page)
  await nameOpenCollection(page, 'Junho')
  await expect.poll(async () => (await savedCollection(page))?.name).toBe('Junho')
  const unreadable = decodeURIComponent(new URL(page.url()).hash.replace('#/c/', ''))
  await context.addInitScript((id) => {
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
      if (key === id) throw new Error('cannot read')
      return get.call(this, key)
    }
  }, unreadable)

  await page.reload()
  await expect(page.getByRole('alert')).toHaveText(/Não foi possível abrir/)
  await page.getByRole('button', { name: 'Ver meus trabalhos', exact: true }).click()
  await expect(page).toHaveURL(/#\/colecoes$/)
  await menuItem(page, 'Maio').click()
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
})

test.describe('on a first visit in Safari', () => {
  test.use({ installHint: true })

  test('it suggests installing, and comes back on a later visit', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Instale o Collage' })
    await expect(dialog).toBeVisible()
    await page.getByRole('button', { name: 'Agora não', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Nova coleção', exact: true })).toBeVisible()
    await expect(dialog).toHaveCount(0)

    await page.evaluate(() => {
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000
      localStorage.setItem('collage.installHintDismissed', String(twoDaysAgo))
    })
    await page.reload()
    await expect(dialog).toBeVisible()
  })
})
