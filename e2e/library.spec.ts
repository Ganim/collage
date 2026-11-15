import { expect, type Page } from '@playwright/test'
import {
  addFrame,
  collectionName,
  customSize,
  editorMenu,
  frameLabel,
  frameWithPhoto,
  goHome,
  nameOpenCollection,
  openNewCollection,
  savedCollection,
  serveAccount,
  test,
} from './helpers'

const menuItem = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const share = (page: Page) => menuItem(page, 'Compartilhar')
const menuSheet = (page: Page) => page.getByRole('dialog', { name: 'Mais opções' })

test.beforeEach(async ({ page, installHint }) => {
  // The install suggestion covers the list, so those tests start under it.
  if (installHint) await page.goto('/#/colecoes')
  else await openNewCollection(page)
})

test('header shows back, name, share and the menu', async ({ page }) => {
  await nameOpenCollection(page, 'Maio')
  const back = menuItem(page, 'Voltar para coleções')
  for (const button of [back, share(page), editorMenu(page)]) {
    await expect(button).toBeVisible()
    await expect(button).toHaveText('')
    const box = (await button.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  await expect(collectionName(page)).toHaveText('Maio')
  await expect(collectionName(page)).toHaveAccessibleName('Renomear Maio')

  await back.click()
  await expect(page).toHaveURL(/#\/colecoes$/)
  await expect(page.getByRole('tab', { name: 'Coleções' })).toBeVisible()
  await expect(menuItem(page, 'Maio')).toBeVisible()
})

test('the menu has the collection options and, with a frame, the frame ones', async ({ page }) => {
  await editorMenu(page).click()
  const sheet = menuSheet(page)
  for (const name of ['Renomear coleção', 'Duplicar coleção', 'Excluir coleção']) {
    await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible()
  }
  for (const name of ['Duplicar frame', 'Remover frame', 'Coleções', 'Salvar em arquivo']) {
    await expect(sheet.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await sheet.getByRole('button', { name: 'Fechar', exact: true }).click()
  await expect(sheet).toHaveCount(0)

  await frameWithPhoto(page)
  await editorMenu(page).click()
  for (const name of [
    'Renomear coleção',
    'Duplicar coleção',
    'Excluir coleção',
    'Duplicar frame',
    'Remover frame',
  ]) {
    await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(sheet.getByRole('button', { name: 'Meus tamanhos', exact: true })).toHaveCount(0)
  // The frame behind must not show through the rows.
  const background = await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(background).toMatch(/^rgb\(/)
})

test('renames from the menu and from the name', async ({ page }) => {
  await editorMenu(page).click()
  await menuItem(page, 'Renomear coleção').click()
  await page.getByLabel('Nome', { exact: true }).fill('  Praia  ')
  await menuItem(page, 'Salvar').click()
  await expect(collectionName(page)).toHaveText('Praia')

  await collectionName(page).click()
  await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Praia')
  await page.getByLabel('Nome', { exact: true }).fill('Serra')
  await menuItem(page, 'Salvar').click()
  await expect(collectionName(page)).toHaveText('Serra')
  await expect.poll(async () => (await savedCollection(page))?.name).toBe('Serra')
})

test('duplicates the collection and opens the copy', async ({ page }) => {
  await frameWithPhoto(page)
  await nameOpenCollection(page, 'Maio')
  const original = page.url()
  await editorMenu(page).click()
  await menuItem(page, 'Duplicar coleção').click()

  await expect(collectionName(page)).toHaveText('Maio (cópia)')
  await expect(page).toHaveURL(/#\/c\/[^/]+$/)
  expect(page.url()).not.toBe(original)
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)

  await goHome(page)
  await expect(menuItem(page, 'Maio')).toBeVisible()
  await expect(menuItem(page, 'Maio (cópia)')).toBeVisible()
})

test('deletes the collection after confirming and returns to the list', async ({ page }) => {
  await nameOpenCollection(page, 'Maio')
  await goHome(page)
  await menuItem(page, 'Nova coleção').click()
  await nameOpenCollection(page, 'Junho')

  await editorMenu(page).click()
  await menuItem(page, 'Excluir coleção').click()
  const confirm = page.getByRole('dialog', { name: 'Excluir Junho?' })
  await confirm.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(collectionName(page)).toHaveText('Junho')

  await editorMenu(page).click()
  await menuItem(page, 'Excluir coleção').click()
  await confirm.getByRole('button', { name: 'Excluir', exact: true }).click()
  await expect(page).toHaveURL(/#\/colecoes$/)
  await expect(menuItem(page, 'Maio')).toBeVisible()
  await expect(menuItem(page, 'Junho')).toHaveCount(0)
  await page.reload()
  await expect(menuItem(page, 'Maio')).toBeVisible()
  await expect(menuItem(page, 'Junho')).toHaveCount(0)
})

test('back right after an edit shows the new name on the card', async ({ page }) => {
  await collectionName(page).click()
  await page.getByLabel('Nome', { exact: true }).fill('Praia')
  await menuItem(page, 'Salvar').click()
  await menuItem(page, 'Voltar para coleções').click()
  await expect(page).toHaveURL(/#\/colecoes$/)
  await expect(menuItem(page, 'Praia')).toBeVisible()
})

test('share opens the print screen with save to file', async ({ page }) => {
  await frameWithPhoto(page)
  await nameOpenCollection(page, 'Maio')
  await share(page).click()
  await expect(page).toHaveURL(/#\/c\/[^/]+\/compartilhar$/)
  await expect(page.getByRole('heading', { name: 'Compartilhar' })).toBeVisible()
  await expect(menuItem(page, 'Gerar PDF')).toBeVisible()

  await menuItem(page, 'Salvar em arquivo').click()
  const downloading = page.waitForEvent('download')
  await menuItem(page, 'Baixar arquivo').click()
  expect((await downloading).suggestedFilename()).toBe('Maio.collage')

  await menuItem(page, 'Voltar').click()
  await expect(page).toHaveURL(/#\/c\/[^/]+$/)
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
})

test('a missing collection link goes back to the list', async ({ page }) => {
  const notice = page.getByRole('status').filter({ hasText: 'Essa coleção não foi encontrada.' })
  await page.goto('/#/c/nao-existe')
  await expect(page).toHaveURL(/#\/colecoes$/)
  await expect(notice).toBeVisible()
  await expect(menuItem(page, 'Nova coleção')).toBeVisible()

  await page.goto('/#/c/nao-existe/compartilhar')
  await expect(page).toHaveURL(/#\/colecoes$/)
  await expect(notice).toBeVisible()
  await menuItem(page, 'Fechar aviso').click()
  await expect(notice).toHaveCount(0)
})

test('duplicating a frame copies its photos', async ({ page }) => {
  await frameWithPhoto(page)
  await editorMenu(page).click()
  await menuItem(page, 'Duplicar frame').click()
  await expect(frameLabel(page, 'Frame 2 de 2').locator('img')).toHaveCount(1)
})

test('removing a frame asks first', async ({ page }) => {
  await frameWithPhoto(page)
  await editorMenu(page).click()
  await menuItem(page, 'Remover frame').click()
  const confirm = page.getByRole('dialog', { name: 'Remover este frame?' })
  await confirm.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(frameLabel(page, 'Frame 1 de 1')).toBeAttached()

  await editorMenu(page).click()
  await menuItem(page, 'Remover frame').click()
  await confirm.getByRole('button', { name: 'Remover', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
})

test('holding the frame opens its menu: duplicate, or remove after asking', async ({ page }) => {
  await frameWithPhoto(page)
  const frame = frameLabel(page, 'Frame 1 de 1')
  const box = (await frame.boundingBox())!
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }
  const hold = async () => {
    await frame.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, ...at })
    await page.waitForTimeout(700)
    await frame.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, ...at })
  }
  const menu = page.getByRole('dialog', { name: 'Este frame' })

  await hold()
  await menu.getByRole('button', { name: 'Duplicar frame', exact: true }).click()
  await expect(menu).toHaveCount(0)
  await expect(frameLabel(page, 'Frame 2 de 2')).toBeAttached()

  // A hold is not a tap: the frame did not go into editing.
  await expect(page.getByRole('button', { name: 'OK', exact: true })).toHaveCount(0)

  const second = frameLabel(page, 'Frame 2 de 2')
  await second.click({ button: 'right' })
  await menu.getByRole('button', { name: 'Remover frame', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Remover este frame?' })
    .getByRole('button', { name: 'Remover', exact: true })
    .click()
  await expect(frameLabel(page, 'Frame 1 de 1')).toBeAttached()
})

test('holding the frame offers to flip its orientation', async ({ page }) => {
  await frameWithPhoto(page)
  const frame = frameLabel(page, 'Frame 1 de 1')
  const box = (await frame.boundingBox())!
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }
  await frame.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, ...at })
  await page.waitForTimeout(700)
  await frame.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, ...at })
  const menu = page.getByRole('dialog', { name: 'Este frame' })

  await expect(page.getByRole('button', { name: '10 × 15 cm' })).toBeVisible()
  await menu.getByRole('button', { name: 'Inverter orientação', exact: true }).click()
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('button', { name: '15 × 10 cm' })).toBeVisible()
})

test('a size saved in the editor is listed under Meus tamanhos', async ({ page }) => {
  await page.getByRole('button', { name: 'Adicionar primeiro frame', exact: true }).click()
  await customSize(page, '9', '12', 'Mesa da sala')

  await goHome(page)
  await page.getByRole('tab', { name: 'Frames' }).click()
  await expect(page).toHaveURL(/#\/frames$/)
  const mine = page.getByRole('link', { name: 'Meus tamanhos', exact: true })
  await expect(mine).toHaveAccessibleDescription('1 tamanho')
  await mine.click()
  await expect(page.getByText('Mesa da sala')).toBeVisible()
})

test('a second collection leaves the first one as it was', async ({ page }) => {
  await frameWithPhoto(page)
  await nameOpenCollection(page, 'Maio')
  await share(page).click()
  const summary = page.getByText(/^\d+ folhas? · \d+%$/)
  await expect(summary).toBeVisible()
  const before = await summary.textContent()
  await menuItem(page, 'Voltar').click()

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
  await share(page).click()
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

test('the top bar names the open work and back lists the others', async ({ page }) => {
  await frameWithPhoto(page)
  await nameOpenCollection(page, 'Maio')
  await expect(collectionName(page)).toHaveText('Maio')
  await goHome(page)
  await menuItem(page, 'Nova coleção').click()
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()

  await goHome(page)
  await menuItem(page, 'Maio').click()
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
  await expect(collectionName(page)).toHaveText('Maio')
})

test('a very long name keeps the top bar and the frame in place', async ({ page }) => {
  await frameWithPhoto(page)
  await nameOpenCollection(page, 'Maio')
  const frame = frameLabel(page, 'Frame 1 de 1')
  const before = (await frame.boundingBox())!

  await nameOpenCollection(page, 'Muito longo '.repeat(20))
  await expect(editorMenu(page)).toBeInViewport({ ratio: 1 })
  const name = (await collectionName(page).boundingBox())!
  const shareBox = (await share(page).boundingBox())!
  expect(name.x + name.width).toBeLessThanOrEqual(shareBox.x)
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
