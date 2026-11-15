import {
  devices,
  expect,
  test as base,
  type BrowserContext,
  type Download,
  type Locator,
  type Page,
} from '@playwright/test'

const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 15 Pro Max']!

/**
 * Each test gets a fresh on-disk profile. Playwright's default context is ephemeral, and
 * WebKit refuses to keep Blobs in IndexedDB there ("Error preparing Blob/File data").
 */
export const test = base.extend<{ installHint: boolean; loggedIn: boolean }>({
  // The suggestion covers the screen on an iPhone's first visit, which is every test's visit.
  installHint: [false, { option: true }],
  // `vite preview` has no sign-in service: the account comes from here.
  loggedIn: [true, { option: true }],
  context: async ({ playwright, baseURL, installHint, loggedIn }, provide, testInfo) => {
    const context = await playwright.webkit.launchPersistentContext(
      testInfo.outputPath('profile'),
      {
        baseURL,
        viewport,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
      },
    )
    if (!installHint) {
      await context.addInitScript(() =>
        localStorage.setItem('collage.installHintDismissed', String(Date.now())),
      )
    }
    await serveAccount(context, loggedIn)
    await provide(context)
    await context.close()
  },
  page: async ({ context }, provide) => {
    await provide(context.pages()[0] ?? (await context.newPage()))
  },
})

export const TEST_ACCOUNT = { email: 'teste@exemplo.com', name: 'Conta de teste', picture: null }

/** Answers the app's "who is signed in" question: the test account, or nobody (401). */
export async function serveAccount(context: BrowserContext, loggedIn = true): Promise<void> {
  await context.route('**/api/auth/me', (route) =>
    loggedIn ? route.fulfill({ status: 200, json: TEST_ACCOUNT }) : route.fulfill({ status: 401 }),
  )
}

/** Starts the way a person would: from the list, on a new empty collection. */
export async function openNewCollection(page: Page): Promise<void> {
  await page.goto('/#/colecoes')
  await page.getByRole('button', { name: 'Nova coleção', exact: true }).click()
  await expect(page).toHaveURL(/#\/c\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
}

/** Draws a JPEG with a canvas in the page. Use a different color per photo: identical bytes are one photo. */
export async function makeJpeg(page: Page, w: number, h: number, color: string): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([width, height, fill]) => {
      const canvas = document.createElement('canvas')
      canvas.width = width as number
      canvas.height = height as number
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = fill as string
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
      ctx.beginPath()
      ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 3, 0, 7)
      ctx.fill()
      return canvas.toDataURL('image/jpeg', 0.9)
    },
    [w, h, color] as const,
  )
  return Buffer.from(dataUrl.split(',')[1] ?? '', 'base64')
}

export async function uploadPhotos(page: Page, buffers: Buffer[]): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(
    buffers.map((buffer, i) => ({
      name: `foto-${i + 1}.jpg`,
      mimeType: 'image/jpeg',
      buffer,
    })),
  )
}

interface SavedCollection {
  name: string
  photoIds: string[]
  frames: { layers: unknown[] }[]
  paper: { widthMm: number; heightMm: number; marginMm: number; gapMm: number }
}

/** The collection as IndexedDB has it right now, to wait for the autosave before a reload. */
export function savedCollection(page: Page): Promise<SavedCollection | undefined> {
  return page.evaluate(
    () =>
      new Promise<SavedCollection | undefined>((resolve, reject) => {
        const open = indexedDB.open('collage')
        open.onerror = () => reject(new Error('could not open the database'))
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['meta', 'collections'])
          const last = tx.objectStore('meta').get('lastCollectionId')
          last.onsuccess = () => {
            if (last.result === undefined) {
              db.close()
              resolve(undefined)
              return
            }
            const got = tx.objectStore('collections').get(last.result as string)
            got.onsuccess = () => {
              db.close()
              resolve(got.result as SavedCollection | undefined)
            }
          }
        }
      }),
  )
}

/** The editor's top-bar name of the open collection; tapping it renames the collection. */
export const collectionName = (page: Page) => page.getByRole('button', { name: /^Renomear .+/ })

/** The editor's ⋮ menu: the collection's options and, with a frame, the current frame's. */
export const editorMenu = (page: Page) =>
  page.getByRole('button', { name: 'Mais opções', exact: true })

export async function goHome(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Voltar para coleções', exact: true }).click()
  await expect(page).toHaveURL(/#\/colecoes$/)
}

/** On the list: renames a collection through its card's options. */
export async function renameFromCard(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole('button', { name: `Opções de ${from}`, exact: true }).click()
  await page.getByRole('button', { name: 'Renomear', exact: true }).click()
  await page.getByLabel('Nome', { exact: true }).fill(to)
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(page.getByRole('button', { name: to.trim(), exact: true })).toBeVisible()
}

/** Renames the collection open in the editor by tapping its name in the top bar. */
export async function nameOpenCollection(page: Page, name: string): Promise<void> {
  await collectionName(page).click()
  await page.getByLabel('Nome', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(collectionName(page)).toHaveText(name.trim())
}

export const frameLabel = (page: Page, label: string) =>
  page.getByRole('img', { name: label, exact: true })

export async function addFrame(page: Page, size = '10×15 cm'): Promise<void> {
  await page.getByRole('button', { name: 'Adicionar frame', exact: true }).click()
  await page.getByRole('button', { name: size, exact: true }).click()
}

/** In the editor: one 10×15 frame with one photo on it. */
export async function frameWithPhoto(page: Page): Promise<void> {
  await uploadPhotos(page, [await makeJpeg(page, 400, 600, '#a8552f')])
  const photo = page.getByRole('button', { name: 'Colocar foto-1.jpg no frame' })
  await expect(photo).toBeVisible()
  await addFrame(page)
  await photo.click()
  await expect(frameLabel(page, 'Frame 1 de 1').locator('img')).toHaveCount(1)
}

/** Saves the open collection to a .collage file from the share screen, then goes back to the editor. */
export async function exportCollection(page: Page): Promise<Download> {
  await page.getByRole('button', { name: 'Compartilhar', exact: true }).click()
  await page.getByRole('button', { name: 'Salvar em arquivo', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).click()
  const download = await downloading
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  await expect(page).toHaveURL(/#\/c\/[^/]+$/)
  return download
}

/** Picks an option in one of the app's selects, the way a person does: open it, tap the option. */
export async function chooseOption(scope: Page | Locator, field: string, option: string) {
  await scope.getByRole('combobox', { name: field, exact: true }).click()
  await scope.getByRole('option', { name: option, exact: true }).click()
}

/**
 * In the size sheet: creates a size (saved in the folder the form shows) and uses it.
 * The sheet must already be open.
 */
export async function customSize(page: Page, width: string, height: string, name?: string) {
  await page.getByRole('button', { name: 'Novo tamanho', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Novo tamanho' })
  if (name) await form.getByLabel('Nome (opcional)').fill(name)
  await form.getByLabel('Largura (cm)').fill(width)
  await form.getByLabel('Altura (cm)').fill(height)
  await form.getByRole('button', { name: 'Salvar e usar', exact: true }).click()
  await expect(form).toHaveCount(0)
}
