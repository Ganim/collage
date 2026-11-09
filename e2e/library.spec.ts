import { readFile } from 'node:fs/promises'
import { expect, type Page } from '@playwright/test'
import { makeJpeg, savedCollection, test, uploadPhotos } from './helpers'

const more = (page: Page) => page.getByRole('button', { name: 'Mais opções', exact: true })
const menuItem = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const closeSheet = (page: Page) => page.getByRole('button', { name: 'Fechar', exact: true }).click()
const frameLabel = (page: Page, label: string) => page.getByRole('img', { name: label, exact: true })

async function openCollections(page: Page) {
  await more(page).click()
  await menuItem(page, 'Coleções').click()
  await expect(page.getByRole('dialog', { name: 'Coleções' })).toBeVisible()
}

async function addFrame(page: Page, size = '10×15 cm') {
  await page.getByRole('button', { name: 'Adicionar frame', exact: true }).click()
  await page.getByRole('button', { name: size, exact: true }).click()
}

async function frameWithPhoto(page: Page) {
  await uploadPhotos(page, [await makeJpeg(page, 400, 600, '#a8552f')])
  const photo = page.getByRole('button', { name: 'Colocar foto-1.jpg no frame' })
  await expect(photo).toBeVisible()
  await addFrame(page)
  await photo.click()
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
}

async function nameCollection(page: Page, name: string) {
  await openCollections(page)
  await page.getByLabel('Nome da coleção').fill(name)
  await closeSheet(page)
}

async function exportCollection(page: Page) {
  await more(page).click()
  await menuItem(page, 'Salvar em arquivo').click()
  const downloading = page.waitForEvent('download')
  await menuItem(page, 'Baixar arquivo').click()
  return downloading
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
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

test('a saved size shows in Meus tamanhos and can be deleted there', async ({ page }) => {
  await page.getByRole('button', { name: 'Adicionar primeiro frame', exact: true }).click()
  await page.getByLabel('Largura (cm)').fill('9')
  await page.getByLabel('Altura (cm)').fill('12')
  await page.getByLabel('Nome (opcional)').fill('Mesa da sala')
  await page.getByRole('button', { name: 'Usar este tamanho', exact: true }).click()

  await more(page).click()
  await menuItem(page, 'Meus tamanhos').click()
  await expect(page.getByText('Mesa da sala')).toBeVisible()
  await page.getByRole('button', { name: 'Apagar Mesa da sala', exact: true }).click()
  await expect(page.getByText('Mesa da sala')).toHaveCount(0)
  await expect(page.getByText('Nenhum tamanho salvo ainda.')).toBeVisible()
})

test('a second collection leaves the first one as it was', async ({ page }) => {
  await frameWithPhoto(page)
  await nameCollection(page, 'Maio')
  await page.getByRole('button', { name: 'Baixar', exact: true }).click()
  const summary = page.getByText(/^\d+ folhas? · \d+%$/)
  await expect(summary).toBeVisible()
  const before = await summary.textContent()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()

  await openCollections(page)
  await menuItem(page, 'Nova coleção').click()
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
  await addFrame(page, '13×18 cm')
  await addFrame(page, '13×18 cm')
  await expect(frameLabel(page, 'Frame 2 de 2')).toBeVisible()
  await nameCollection(page, 'Junho')

  await openCollections(page)
  await page.getByRole('button', { name: /^Maio\b/ }).click()
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
  await page.getByRole('button', { name: 'Baixar', exact: true }).click()
  await expect(summary).toHaveText(before!)
})

test('deleting a collection takes a second tap and opens another', async ({ page }) => {
  await frameWithPhoto(page)
  await nameCollection(page, 'Maio')
  await openCollections(page)
  await menuItem(page, 'Nova coleção').click()
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
  await nameCollection(page, 'Junho')

  await openCollections(page)
  await page.getByRole('button', { name: 'Apagar Junho', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Junho\b/ })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar apagar Junho', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Junho\b/ })).toHaveCount(0)
  await expect(page.getByLabel('Nome da coleção')).toHaveValue('Maio')
  await closeSheet(page)
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
})

test('a collection exported and deleted comes back from its file', async ({ page }) => {
  await frameWithPhoto(page)
  await nameCollection(page, 'Maio')
  const download = await exportCollection(page)
  expect(download.suggestedFilename()).toBe('Maio.collage')
  const file = await readFile(await download.path())

  await openCollections(page)
  await page.getByRole('button', { name: 'Apagar Maio', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar apagar Maio', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Maio\b/ })).toHaveCount(0)

  await page.getByLabel('Abrir de um arquivo').setInputFiles({
    name: 'Maio.collage',
    mimeType: 'application/zip',
    buffer: file,
  })
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
  await expect.poll(async () => (await savedCollection(page))?.frames.length).toBe(1)
})

test('an invalid file shows a message and changes nothing', async ({ page }) => {
  await frameWithPhoto(page)
  await nameCollection(page, 'Maio')
  await openCollections(page)
  await page.getByLabel('Abrir de um arquivo').setInputFiles({
    name: 'nota.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('isto não é uma coleção'),
  })
  await expect(page.getByText('Este arquivo não é uma coleção do Collage.')).toBeVisible()
  await expect(page.getByLabel('Nome da coleção')).toHaveValue('Maio')
  await expect(page.getByRole('button', { name: /^Maio\b/ })).toHaveCount(1)
})

// The service worker never became ready in the persistent profile the other tests need for Blobs.
test('after the first visit the app loads offline', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
  await context.close()
})

test.describe('on a first visit in Safari', () => {
  test.use({ installHint: true })

  test('it suggests installing, and comes back on a later visit', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Instale o Collage' })
    await expect(dialog).toBeVisible()
    await page.getByRole('button', { name: 'Agora não', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
    await expect(dialog).toHaveCount(0)

    await page.evaluate(() => {
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000
      localStorage.setItem('collage.installHintDismissed', String(twoDaysAgo))
    })
    await page.reload()
    await expect(dialog).toBeVisible()
  })
})
