import { readFile } from 'node:fs/promises'
import { expect, type Page } from '@playwright/test'
import {
  collectionName,
  exportCollection,
  frameLabel,
  frameWithPhoto,
  goHome,
  nameOpenCollection,
  openNewCollection,
  renameFromCard,
  savedCollection,
  test,
} from './helpers'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/** A card's open button is named after its collection. */
const card = button

async function removeFromCard(page: Page, name: string) {
  await button(page, `Opções de ${name}`).click()
  await button(page, 'Excluir').click()
  await page
    .getByRole('dialog', { name: `Excluir ${name}?` })
    .getByRole('button', { name: 'Excluir', exact: true })
    .click()
  await expect(card(page, name)).toHaveCount(0)
}

test('shows the account and signs out after confirming', async ({ page, context }) => {
  await context.route('**/api/auth/logout', (r) => r.fulfill({ status: 204 }))
  await page.goto('/#/colecoes')
  const avatar = button(page, 'Sua conta')
  await expect(avatar).toHaveText('C')
  await avatar.click()
  const sheet = page.getByRole('dialog', { name: 'Sua conta' })
  await expect(sheet.getByText('Conta de teste')).toBeVisible()
  await expect(sheet.getByText('teste@exemplo.com')).toBeVisible()

  await button(page, 'Sair').click()
  const confirm = page.getByRole('dialog', { name: 'Sair da conta?' })
  await expect(confirm.getByText('Suas coleções continuam neste aparelho.')).toBeVisible()
  await button(page, 'Cancelar').click()
  await expect(confirm).toHaveCount(0)
  await expect(button(page, 'Nova coleção')).toBeVisible()

  await avatar.click()
  await button(page, 'Sair').click()
  await confirm.getByRole('button', { name: 'Sair', exact: true }).click()
  await expect(button(page, 'Entrar com Google')).toBeVisible()
})

test('signing out offline says entering again needs internet', async ({ page, context }) => {
  await page.goto('/#/colecoes')
  await expect(button(page, 'Nova coleção')).toBeVisible()
  const confirm = page.getByRole('dialog', { name: 'Sair da conta?' })
  const offlineLine = confirm.getByText(
    'Você está sem internet. Para entrar de novo, vai precisar de conexão.',
  )

  await button(page, 'Sua conta').click()
  await button(page, 'Sair').click()
  await expect(confirm.getByText('Suas coleções continuam neste aparelho.')).toBeVisible()
  await expect(offlineLine).toHaveCount(0)
  await button(page, 'Cancelar').click()

  await context.setOffline(true)
  await button(page, 'Sua conta').click()
  await button(page, 'Sair').click()
  await expect(offlineLine).toBeVisible()
  await button(page, 'Cancelar').click()
  await context.setOffline(false)
})

test('creates a collection and opens the editor', async ({ page }) => {
  await page.goto('/#/colecoes')
  await button(page, 'Nova coleção').click()
  await expect(page).toHaveURL(/#\/c\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()

  await goHome(page)
  await expect(page.getByText('Nenhum frame · nenhuma foto', { exact: true })).toBeVisible()
  await expect(page.getByText(/^\d{2}\/\d{2}\/\d{4}$/)).toBeVisible()
})

test('empty state invites the first collection', async ({ page }) => {
  await page.goto('/#/colecoes')
  await expect(page.locator('[data-illustration="empty-collections"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nenhuma coleção ainda' })).toBeVisible()
  await expect(page.getByText('Crie a primeira e comece a montar suas fotos.')).toBeVisible()
  await expect(button(page, 'Nova coleção')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Coleções' })).toHaveAttribute('aria-selected', 'true')
})

test('renames, duplicates and deletes from the card', async ({ page }) => {
  await openNewCollection(page)
  await nameOpenCollection(page, 'Maio')
  await goHome(page)

  await button(page, 'Opções de Maio').click()
  await button(page, 'Renomear').click()
  const field = page.getByLabel('Nome', { exact: true })
  await expect(field).toHaveValue('Maio')
  await field.fill('   ')
  await expect(button(page, 'Salvar')).toBeDisabled()
  await button(page, 'Fechar').click()

  await renameFromCard(page, 'Maio', 'Praia')
  await expect(card(page, 'Maio')).toHaveCount(0)

  await button(page, 'Opções de Praia').click()
  await button(page, 'Duplicar').click()
  await expect(card(page, 'Praia (cópia)')).toBeVisible()

  await button(page, 'Opções de Praia (cópia)').click()
  await button(page, 'Excluir').click()
  const confirm = page.getByRole('dialog', { name: 'Excluir Praia (cópia)?' })
  await expect(
    confirm.getByText('As fotos que só estão nesta coleção serão apagadas do aparelho.'),
  ).toBeVisible()
  await button(page, 'Cancelar').click()
  await expect(confirm).toHaveCount(0)
  await expect(card(page, 'Praia (cópia)')).toBeVisible()

  await removeFromCard(page, 'Praia (cópia)')
  await expect(card(page, 'Praia')).toBeVisible()
})

// The open collection goes with its edits; the editor is left on a draft that is not saved.
test('deleting the open collection leaves the others as they were', async ({ page }) => {
  await openNewCollection(page)
  await frameWithPhoto(page)
  await nameOpenCollection(page, 'Maio')
  await goHome(page)
  await button(page, 'Nova coleção').click()
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
  await nameOpenCollection(page, 'Junho')
  const junho = new URL(page.url()).hash
  await goHome(page)

  await removeFromCard(page, 'Junho')
  // An old link to it (the address it had, without reloading) lands on the list.
  await page.evaluate((hash) => (location.hash = hash), junho)
  await expect(page).toHaveURL(/#\/colecoes$/)
  await expect(page.getByText('Essa coleção não foi encontrada.')).toBeVisible()
  await expect(card(page, 'Maio')).toBeVisible()
  await expect(card(page, 'Junho')).toHaveCount(0)
  await card(page, 'Maio').click()
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
})

test('the mouldings tab says coming soon', async ({ page }) => {
  await page.goto('/#/colecoes')
  const tab = page.getByRole('tab', { name: 'Molduras' })
  await tab.click()
  await expect(page).toHaveURL(/#\/molduras$/)
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-illustration="coming-soon"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Em breve' })).toBeVisible()
  await expect(page.getByText('Aqui você vai escolher molduras para os seus frames.')).toBeVisible()

  await page.getByRole('tab', { name: 'Coleções' }).click()
  await expect(page).toHaveURL(/#\/colecoes$/)
  await expect(button(page, 'Nova coleção')).toBeVisible()
})

test('opens a .collage file from the list', async ({ page }) => {
  await openNewCollection(page)
  await frameWithPhoto(page)
  await nameOpenCollection(page, 'Maio')
  const download = await exportCollection(page)
  expect(download.suggestedFilename()).toBe('Maio.collage')
  const file = await readFile(await download.path())

  await goHome(page)
  await removeFromCard(page, 'Maio')

  await page.getByLabel('Importar coleção').setInputFiles({
    name: 'Maio.collage',
    mimeType: 'application/zip',
    buffer: file,
  })
  await expect(page).toHaveURL(/#\/c\/[^/]+$/)
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
  await expect.poll(async () => (await savedCollection(page))?.frames.length).toBe(1)
})

test('an invalid file shows a message and changes nothing', async ({ page }) => {
  await openNewCollection(page)
  await nameOpenCollection(page, 'Maio')
  await goHome(page)
  await page.getByLabel('Importar coleção').setInputFiles({
    name: 'nota.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('isto não é uma coleção'),
  })
  await expect(page.getByText('Este arquivo não é uma coleção do Collage.')).toBeVisible()
  await expect(page).toHaveURL(/#\/colecoes$/)
  await expect(card(page, 'Maio')).toHaveCount(1)
})

test('a list that cannot be read offers a retry', async ({ page, context }) => {
  await openNewCollection(page)
  await nameOpenCollection(page, 'Maio')
  await expect.poll(async () => (await savedCollection(page))?.name).toBe('Maio')
  await context.addInitScript(() => {
    const getAll = IDBObjectStore.prototype.getAll
    IDBObjectStore.prototype.getAll = function (...args: Parameters<typeof getAll>) {
      if (sessionStorage.getItem('failList') && this.name === 'collections') {
        throw new Error('cannot read')
      }
      return getAll.apply(this, args)
    }
  })
  await page.evaluate(() => sessionStorage.setItem('failList', '1'))

  await page.goto('/#/colecoes')
  await page.reload()
  await expect(page.getByText('Não foi possível ler as coleções.')).toBeVisible()
  await expect(card(page, 'Maio')).toHaveCount(0)

  await page.evaluate(() => sessionStorage.removeItem('failList'))
  await button(page, 'Tentar de novo').click()
  await card(page, 'Maio').click()
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
  await expect(collectionName(page)).toHaveText('Maio')
})

test.describe('the back gesture after leaving the editor', () => {
  /** Mouldings first, so going back past the list lands somewhere visible. */
  async function fromTheList(page: Page) {
    await page.goto('/#/molduras')
    await page.getByRole('tab', { name: 'Coleções' }).click()
    await expect(page).toHaveURL(/#\/colecoes$/)
    await button(page, 'Nova coleção').click()
    await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
  }

  test('back then the gesture does not reopen the collection', async ({ page }) => {
    await fromTheList(page)
    await goHome(page)
    await page.goBack()
    await expect(page).toHaveURL(/#\/molduras$/)
    await expect(page.getByRole('heading', { name: 'Em breve' })).toBeVisible()
  })

  test('delete then the gesture does not show the not-found notice', async ({ page }) => {
    await fromTheList(page)
    await page.getByRole('button', { name: 'Mais opções', exact: true }).click()
    await button(page, 'Excluir coleção').click()
    await page
      .getByRole('dialog', { name: /^Excluir .+\?$/ })
      .getByRole('button', { name: 'Excluir', exact: true })
      .click()
    await expect(page).toHaveURL(/#\/colecoes$/)
    await page.goBack()
    await expect(page).toHaveURL(/#\/molduras$/)
    await expect(page.getByText('Essa coleção não foi encontrada.')).toHaveCount(0)
  })

  test('share, back, then the gesture reaches the list', async ({ page }) => {
    await fromTheList(page)
    await button(page, 'Compartilhar').click()
    await expect(page).toHaveURL(/#\/c\/[^/]+\/compartilhar$/)
    await button(page, 'Voltar').click()
    await expect(page).toHaveURL(/#\/c\/[^/]+$/)
    await page.goBack()
    await expect(page).toHaveURL(/#\/colecoes$/)
    await expect(button(page, 'Nova coleção')).toBeVisible()
  })
})

test('the account menu reloads the app and keeps the collections', async ({ page }) => {
  await openNewCollection(page)
  await nameOpenCollection(page, 'Natal')
  await goHome(page)

  await button(page, 'Sua conta').click()
  const reloaded = page.waitForEvent('load')
  await button(page, 'Atualizar o app').click()
  await reloaded
  await expect(card(page, 'Natal')).toBeVisible()
})
