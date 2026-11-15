import { expect, type Page } from '@playwright/test'
import { createFakeDriveState, routeFakeDrive, type FakeDriveState } from './fakeDrive'
import {
  frameLabel,
  frameWithPhoto,
  goHome,
  nameOpenCollection,
  newDevice,
  serveAccount,
  test,
} from './helpers'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/** The names of the collections the Drive holds and has not trashed. */
function namesOnDrive(state: FakeDriveState): string[] {
  return [...state.files.values()]
    .filter((f) => f.appProperties.kind === 'collection' && !f.trashed)
    .map((f) => (JSON.parse(f.body.toString('utf8')) as { name: string }).name)
    .sort()
}

/**
 * Taps "Sincronizar agora" in the account menu and closes it once no pass is running. What the
 * pass did is checked by the caller, on the screen or on the Drive.
 */
async function syncNow(page: Page): Promise<void> {
  await button(page, 'Sua conta').click()
  const sheet = page.getByRole('dialog', { name: 'Sua conta' })
  const now = sheet.getByRole('button', { name: 'Sincronizar agora', exact: true })
  // Disabled while a pass (on mount, or 4 s after an edit) is running.
  await expect(now).toBeEnabled()
  await now.click()
  await expect(now).toBeEnabled()
  await expect(sheet.getByRole('status')).toHaveText(/^Sincronizado/)
  await sheet.getByRole('button', { name: 'Fechar', exact: true }).click()
  await expect(sheet).toHaveCount(0)
}

test('two devices on one Drive see each other’s changes', async ({ playwright }, testInfo) => {
  const drive = createFakeDriveState()
  const a = await newDevice(playwright, testInfo, 'a', { drive: true })
  const b = await newDevice(playwright, testInfo, 'b', { drive: true })
  await routeFakeDrive(a.context, drive)
  await routeFakeDrive(b.context, drive)

  try {
    // A makes a collection with a photo on a frame; it reaches the Drive.
    await a.page.goto('/#/colecoes')
    await button(a.page, 'Nova coleção').click()
    await expect(a.page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
    await frameWithPhoto(a.page)
    await nameOpenCollection(a.page, 'Viagem')
    await goHome(a.page)
    await syncNow(a.page)
    await expect.poll(() => namesOnDrive(drive)).toEqual(['Viagem'])
    const photos = [...drive.files.values()].filter((f) => f.appProperties.kind === 'photo')
    expect(photos.map((f) => [f.mimeType, f.body.length > 0])).toEqual([['image/jpeg', true]])
    await expect(button(a.page, 'Sincronizado agora')).toBeVisible()

    // B opens and finds it, photo included.
    await b.page.goto('/#/colecoes')
    await expect(button(b.page, 'Viagem')).toBeVisible()
    await button(b.page, 'Viagem').click()
    await expect(b.page).toHaveURL(/#\/c\/[^/]+$/)
    await expect(frameLabel(b.page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
    await goHome(b.page)

    // B renames; A syncs and sees the new name.
    await button(b.page, 'Opções de Viagem').click()
    await button(b.page, 'Renomear').click()
    await b.page.getByLabel('Nome', { exact: true }).fill('Viagem à praia')
    await button(b.page, 'Salvar').click()
    await expect(button(b.page, 'Viagem à praia')).toBeVisible()
    await syncNow(b.page)
    await expect.poll(() => namesOnDrive(drive)).toEqual(['Viagem à praia'])

    await syncNow(a.page)
    await expect(button(a.page, 'Viagem à praia')).toBeVisible()
    await expect(button(a.page, 'Viagem')).toHaveCount(0)

    // A deletes; B syncs and it is gone.
    await button(a.page, 'Opções de Viagem à praia').click()
    await button(a.page, 'Excluir').click()
    await a.page
      .getByRole('dialog', { name: 'Excluir Viagem à praia?' })
      .getByRole('button', { name: 'Excluir', exact: true })
      .click()
    await expect(button(a.page, 'Viagem à praia')).toHaveCount(0)
    await syncNow(a.page)
    await expect.poll(() => namesOnDrive(drive)).toEqual([])

    await syncNow(b.page)
    await expect(button(b.page, 'Viagem à praia')).toHaveCount(0)
  } finally {
    await a.context.close()
    await b.context.close()
  }
})

test('editing a synced collection on one device and going back makes no copy', async ({
  playwright,
}, testInfo) => {
  // Like Google, the Drive moves a file's version on after the upload has answered.
  const drive = createFakeDriveState({ bumpVersionAfterWrite: true })
  const a = await newDevice(playwright, testInfo, 'a', { drive: true })
  await routeFakeDrive(a.context, drive)

  try {
    await a.page.goto('/#/colecoes')
    await button(a.page, 'Nova coleção').click()
    await expect(a.page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
    await frameWithPhoto(a.page)
    await nameOpenCollection(a.page, 'Viagem')
    await goHome(a.page)
    await syncNow(a.page)
    await expect.poll(() => namesOnDrive(drive)).toEqual(['Viagem'])

    for (const [from, name] of [
      ['Viagem', 'Viagem 2'],
      ['Viagem 2', 'Viagem 3'],
    ] as const) {
      await button(a.page, from).click()
      await expect(a.page).toHaveURL(/#\/c\/[^/]+$/)
      await nameOpenCollection(a.page, name)
      await goHome(a.page)
      await syncNow(a.page)
      await expect.poll(() => namesOnDrive(drive)).toEqual([name])
    }
    await expect(button(a.page, 'Viagem 3')).toBeVisible()
    await expect(a.page.getByRole('button', { name: /cópia de outro aparelho/ })).toHaveCount(0)
  } finally {
    await a.context.close()
  }
})

test('without Drive access the account offers to connect it', async ({ page }) => {
  // The test account has not granted the Drive.
  await page.goto('/#/colecoes')
  await expect(button(page, 'Só neste aparelho')).toBeVisible()
  await button(page, 'Sua conta').click()
  const sheet = page.getByRole('dialog', { name: 'Sua conta' })
  await expect(
    sheet.getByRole('button', { name: 'Conectar ao Google Drive para sincronizar', exact: true }),
  ).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Sincronizar agora', exact: true })).toHaveCount(0)
})

const privacyHeading = (page: Page) => page.getByRole('heading', { name: 'Privacidade', level: 1 })

test('the account menu opens the privacy page', async ({ page }) => {
  await page.goto('/#/colecoes')
  await button(page, 'Sua conta').click()
  const opening = page.context().waitForEvent('page')
  await page
    .getByRole('dialog', { name: 'Sua conta' })
    .getByRole('link', { name: 'Privacidade', exact: true })
    .click()
  const privacy = await opening
  await expect(privacy).toHaveURL(/\/privacidade\.html$/)
  await expect(privacyHeading(privacy)).toBeVisible()
  await expect(privacy.getByRole('link', { name: 'myaccount.google.com' })).toBeVisible()
})

// The service worker never becomes ready in the persistent profile, so this one goes without it.
test('the offline app serves the privacy page, not itself', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  await serveAccount(context)
  const page = await context.newPage()
  await page.goto('/')
  await expect(button(page, 'Nova coleção')).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })

  await context.setOffline(true)
  await page.goto('/privacidade.html')
  await expect(privacyHeading(page)).toBeVisible()
  await expect(button(page, 'Nova coleção')).toHaveCount(0)
  await context.close()
})

test.describe('an account without the Drive', () => {
  test.use({ connectPrompt: true })

  test('is offered once to connect it; the account menu keeps the offer', async ({ page }) => {
    await page.goto('/#/colecoes')
    const offer = page.getByRole('dialog', { name: 'Conectar ao Google Drive para sincronizar' })
    await expect(offer).toBeVisible()
    await expect(offer).toContainText('aparecem nos outros aparelhos')
    await expect(offer.getByRole('button', { name: 'Conectar', exact: true })).toBeVisible()
    await offer.getByRole('button', { name: 'Agora não', exact: true }).click()
    await expect(offer).toHaveCount(0)

    await page.reload()
    await expect(button(page, 'Nova coleção')).toBeVisible()
    await expect(button(page, 'Só neste aparelho')).toBeVisible()
    await expect(offer).toHaveCount(0)
    await button(page, 'Sua conta').click()
    await expect(
      page
        .getByRole('dialog', { name: 'Sua conta' })
        .getByRole('button', { name: 'Conectar ao Google Drive para sincronizar' }),
    ).toBeVisible()
  })
})
