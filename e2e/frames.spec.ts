import { expect, type Page } from '@playwright/test'
import { chooseOption, openNewCollection, test } from './helpers'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const folderLink = (page: Page, name: string) => page.getByRole('link', { name, exact: true })
const sizeRow = (page: Page, name: string) =>
  page.getByRole('main').getByRole('listitem').filter({ hasText: name })

/** From the folder list: creates a folder, which then opens. */
async function createFolder(page: Page, name: string) {
  await page.goto('/#/frames')
  await button(page, 'Nova pasta').click()
  await page.getByLabel('Nome', { exact: true }).fill(name)
  await button(page, 'Salvar').click()
  await expect(page).toHaveURL(/#\/frames\/[^/]+$/)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

/** Fills the size form already open and saves it. */
async function fillSize(page: Page, name: string, width: string, height: string) {
  const form = page.getByRole('dialog', { name: 'Novo tamanho' })
  const save = form.getByRole('button', { name: 'Salvar', exact: true })
  await form.getByLabel('Largura (cm)').fill(width)
  await form.getByLabel('Altura (cm)').fill(height)
  // The name is required here.
  await expect(save).toBeDisabled()
  await form.getByLabel('Nome', { exact: true }).fill(name)
  await save.click()
  await expect(form).toHaveCount(0)
}

test('creates a folder and a size inside it', async ({ page }) => {
  await createFolder(page, 'Quarto')
  await expect(page.getByText('Nenhum tamanho nesta pasta')).toBeVisible()
  await expect(page.locator('[data-illustration="empty-folder"]')).toBeVisible()

  await button(page, 'Novo tamanho').click()
  await expect(page.getByRole('combobox', { name: 'Pasta', exact: true })).toHaveText('Quarto')
  await fillSize(page, 'Cabeceira', '9', '12')
  await expect(sizeRow(page, 'Cabeceira')).toContainText('9×12 cm')

  await page.getByRole('link', { name: 'Voltar', exact: true }).click()
  await expect(page).toHaveURL(/#\/frames$/)
  await expect(folderLink(page, 'Quarto')).toHaveAccessibleDescription('1 tamanho')
  await expect(folderLink(page, 'Tamanhos padrão')).toHaveAccessibleDescription('6 tamanhos')
  await expect(folderLink(page, 'Meus tamanhos')).toHaveAccessibleDescription('Nenhum tamanho')

  await page.reload()
  await folderLink(page, 'Quarto').click()
  await expect(sizeRow(page, 'Cabeceira')).toBeVisible()
})

test('deleting a folder moves its sizes to Meus tamanhos', async ({ page }) => {
  await createFolder(page, 'Quarto')
  await button(page, 'Novo tamanho').click()
  await fillSize(page, 'Cabeceira', '9', '12')

  await button(page, 'Opções da pasta Quarto').click()
  await button(page, 'Excluir').click()
  const confirm = page.getByRole('dialog', { name: 'Excluir a pasta Quarto?' })
  await expect(confirm.getByText('Os tamanhos dela vão para Meus tamanhos.')).toBeVisible()
  await confirm.getByRole('button', { name: 'Excluir', exact: true }).click()

  await expect(page).toHaveURL(/#\/frames$/)
  await expect(folderLink(page, 'Quarto')).toHaveCount(0)
  await expect(folderLink(page, 'Meus tamanhos')).toHaveAccessibleDescription('1 tamanho')
  await folderLink(page, 'Meus tamanhos').click()
  await expect(sizeRow(page, 'Cabeceira')).toBeVisible()
})

test('defaults folder has the six presets and no edit menu', async ({ page }) => {
  await page.goto('/#/frames')
  await folderLink(page, 'Tamanhos padrão').click()
  await expect(page).toHaveURL(/#\/frames\/padrao$/)
  await expect(page.getByRole('heading', { name: 'Tamanhos padrão' })).toBeVisible()
  const rows = page.getByRole('main').getByRole('list').getByRole('listitem')
  await expect(rows).toHaveCount(6)
  for (const size of ['10×15 cm', '13×18 cm', '15×21 cm', '20×25 cm', '20×30 cm', '5×7 cm']) {
    await expect(rows.filter({ hasText: size })).toHaveCount(1)
  }
  await expect(page.getByRole('button', { name: /^Opções/ })).toHaveCount(0)
  await expect(button(page, 'Novo tamanho')).toHaveCount(0)

  // Meus tamanhos can be neither renamed nor deleted.
  await page.goto('/#/frames/meus')
  await expect(page.getByRole('heading', { name: 'Meus tamanhos' })).toBeVisible()
  await expect(page.getByText('Nenhum tamanho nesta pasta')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Opções/ })).toHaveCount(0)

  // A folder that is not there shows the list.
  await page.goto('/#/frames/nenhuma')
  await expect(button(page, 'Nova pasta')).toBeVisible()
  await expect(folderLink(page, 'Tamanhos padrão')).toBeVisible()
})

test('edits and deletes a size with confirmation', async ({ page }) => {
  await createFolder(page, 'Quarto')
  await page.getByRole('link', { name: 'Voltar', exact: true }).click()
  await button(page, 'Novo tamanho').click()
  await expect(page.getByRole('combobox', { name: 'Pasta', exact: true })).toHaveText(
    'Meus tamanhos',
  )
  await fillSize(page, 'Mesa', '9', '12')
  await folderLink(page, 'Meus tamanhos').click()
  await expect(sizeRow(page, 'Mesa')).toBeVisible()

  await button(page, 'Opções de Mesa').click()
  await button(page, 'Editar').click()
  const form = page.getByRole('dialog', { name: 'Editar tamanho' })
  await expect(form.getByLabel('Nome', { exact: true })).toHaveValue('Mesa')
  await form.getByLabel('Nome', { exact: true }).fill('Mesa da sala')
  await chooseOption(form, 'Pasta', 'Quarto')
  await form.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(page.getByText('Nenhum tamanho nesta pasta')).toBeVisible()

  await page.getByRole('link', { name: 'Voltar', exact: true }).click()
  await folderLink(page, 'Quarto').click()
  await expect(sizeRow(page, 'Mesa da sala')).toContainText('9×12 cm')

  await button(page, 'Opções de Mesa da sala').click()
  await button(page, 'Excluir').click()
  const confirm = page.getByRole('dialog', { name: 'Excluir Mesa da sala?' })
  await confirm.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(sizeRow(page, 'Mesa da sala')).toBeVisible()

  await button(page, 'Opções de Mesa da sala').click()
  await button(page, 'Excluir').click()
  await confirm.getByRole('button', { name: 'Excluir', exact: true }).click()
  await expect(sizeRow(page, 'Mesa da sala')).toHaveCount(0)
  await expect(page.getByText('Nenhum tamanho nesta pasta')).toBeVisible()
})

test('the editor size picker shows sizes by folder', async ({ page }) => {
  await createFolder(page, 'Quarto')
  await button(page, 'Novo tamanho').click()
  await fillSize(page, 'Cabeceira', '9', '12')

  await openNewCollection(page)
  await button(page, 'Adicionar primeiro frame').click()
  const picker = page.getByRole('dialog', { name: 'Novo frame' })
  await expect(picker.getByRole('heading')).toHaveText([
    'Novo frame',
    'Tamanhos padrão',
    'Quarto',
    'Personalizado',
  ])
  await expect(
    picker.getByRole('region', { name: 'Tamanhos padrão' }).getByRole('button'),
  ).toHaveCount(6)
  await picker
    .getByRole('region', { name: 'Quarto' })
    .getByRole('button', { name: /Cabeceira/ })
    .click()
  await expect(page.getByRole('button', { name: '9 × 12 cm' })).toBeVisible()
})

test('Escape closes the folder list first, then the form', async ({ page }) => {
  await page.goto('/#/frames')
  await button(page, 'Novo tamanho').click()
  const form = page.getByRole('dialog', { name: 'Novo tamanho' })
  await form.getByRole('combobox', { name: 'Pasta', exact: true }).click()
  await expect(form.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(form.getByRole('listbox')).toHaveCount(0)
  await expect(form).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(form).toHaveCount(0)
})
