import { expect, type Page } from '@playwright/test'
import { makeJpeg, savedCollection, test, uploadPhotos } from './helpers'

const trayPhoto = (page: Page, name: string) =>
  page.getByRole('button', { name: `Colocar ${name} no frame` })

const frame = (page: Page, position: number, total: number) =>
  page.getByRole('img', { name: `Frame ${position} de ${total}`, exact: true })

const carousel = (page: Page) => page.getByRole('region', { name: 'Frames', exact: true })

const dot = (page: Page, position: number) =>
  page.getByRole('button', { name: `Ir para o frame ${position}`, exact: true })

async function addFrame(page: Page, preset: string) {
  await page.getByRole('button', { name: 'Adicionar frame', exact: true }).click()
  await page.getByRole('button', { name: preset, exact: true }).click()
}

async function ratio(page: Page, position: number, total: number) {
  const box = await frame(page, position, total).boundingBox()
  if (!box) throw new Error('frame is not visible')
  return box.width / box.height
}

/** The carousel's own scroller, moved the way a finger would leave it. */
async function swipeTo(page: Page, position: number) {
  await carousel(page).evaluate((el, target) => {
    const slide = el.children[target - 1] as HTMLElement | undefined
    if (!slide) throw new Error('no such slide')
    el.scrollTo({ left: slide.offsetLeft - (el.clientWidth - slide.offsetWidth) / 2 })
  }, position)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('opens without sign-up on a welcoming empty state', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Seu primeiro frame' })).toBeVisible()
  await page.getByRole('button', { name: 'Adicionar primeiro frame' }).click()
  await page.getByRole('button', { name: '13×18 cm', exact: true }).click()
  await expect(frame(page, 1, 1)).toBeVisible()
  await expect(page.getByRole('button', { name: '13 × 18 cm' })).toBeVisible()
  await expect(page.getByText('Adicionar fotos', { exact: true })).toBeVisible()
})

test('placing a landscape photo turns the frame and keeps the photo proportions', async ({
  page,
}) => {
  await uploadPhotos(page, [
    await makeJpeg(page, 800, 400, '#a8552f'),
    await makeJpeg(page, 400, 600, '#2f5fa8'),
  ])
  await expect(trayPhoto(page, 'foto-2.jpg')).toBeVisible()

  await addFrame(page, '10×15 cm')
  await expect(page.getByRole('button', { name: '10 × 15 cm' })).toBeVisible()
  await trayPhoto(page, 'foto-1.jpg').click()

  await expect(page.getByRole('button', { name: '15 × 10 cm' })).toBeVisible()
  expect(await ratio(page, 1, 1)).toBeCloseTo(150 / 100, 1)

  const image = frame(page, 1, 1).locator('img')
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true)
  const box = await image.boundingBox()
  expect(box!.width / box!.height).toBeCloseTo(2, 1)
})

test('the frame fits the stage for wide and tall sizes', async ({ page }) => {
  await addFrame(page, '20×30 cm')
  const stage = (await carousel(page).boundingBox())!
  const tall = (await frame(page, 1, 1).boundingBox())!
  expect(tall.height).toBeLessThanOrEqual(stage.height)
  expect(tall.width / tall.height).toBeCloseTo(200 / 300, 1)

  await page.getByRole('button', { name: '20 × 30 cm' }).click()
  await page.getByRole('button', { name: 'Inverter orientação' }).click()
  await expect(page.getByRole('button', { name: '30 × 20 cm' })).toBeVisible()
  await expect.poll(() => ratio(page, 1, 1)).toBeCloseTo(300 / 200, 1)
  const wide = (await frame(page, 1, 1).boundingBox())!
  expect(wide.width).toBeLessThanOrEqual(stage.width)
})

test('new-frame mode can flip the size before choosing it', async ({ page }) => {
  await page.getByRole('button', { name: 'Adicionar frame', exact: true }).click()
  await page.getByRole('button', { name: 'Inverter orientação' }).click()
  await page.getByRole('button', { name: '15×10 cm', exact: true }).click()
  await expect(page.getByRole('button', { name: '15 × 10 cm' })).toBeVisible()
})

test('swiping and the dots agree on the active frame', async ({ page }) => {
  await addFrame(page, '10×15 cm')
  await addFrame(page, '20×30 cm')
  await expect(dot(page, 2)).toHaveAttribute('aria-current', 'true')

  await dot(page, 1).click()
  await expect(dot(page, 1)).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('button', { name: '10 × 15 cm' })).toBeVisible()

  await swipeTo(page, 2)
  await expect(dot(page, 2)).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('button', { name: '20 × 30 cm' })).toBeVisible()

  await dot(page, 1).click()
  await expect(dot(page, 1)).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('button', { name: '10 × 15 cm' })).toBeVisible()
})

test('only frames next to the active one load their images', async ({ page }) => {
  await uploadPhotos(page, [await makeJpeg(page, 600, 400, '#6a8f3a')])
  await expect(trayPhoto(page, 'foto-1.jpg')).toBeVisible()
  for (let i = 0; i < 3; i++) {
    await addFrame(page, '10×15 cm')
    await trayPhoto(page, 'foto-1.jpg').click()
  }
  await expect(frame(page, 3, 3).locator('img')).toHaveCount(1)
  await expect(frame(page, 2, 3).locator('img')).toHaveCount(1)
  await expect(frame(page, 1, 3).locator('img')).toHaveCount(0)
})

test('header actions are icon-only buttons with accessible names', async ({ page }) => {
  for (const name of ['Mais opções', 'Baixar']) {
    const button = page.getByRole('button', { name, exact: true })
    await expect(button).toBeVisible()
    await expect(button).toHaveText('')
    const box = (await button.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
})

test('a named custom size is created and still listed after reloading', async ({ page }) => {
  await page.getByRole('button', { name: 'Adicionar frame', exact: true }).click()
  await page.getByLabel('Largura (cm)').fill('12')
  await page.getByLabel('Altura (cm)').fill('12')
  await page.getByLabel('Nome (opcional)').fill('Quadrado')
  await page.getByRole('button', { name: 'Usar este tamanho' }).click()
  await expect(page.getByRole('button', { name: '12 × 12 cm' })).toBeVisible()

  await expect.poll(async () => (await savedCollection(page))?.frames.length).toBe(1)
  await page.reload()
  await page.getByRole('button', { name: '12 × 12 cm' }).click()
  await expect(page.getByRole('button', { name: /Quadrado/ })).toBeVisible()
})

test('frames and photos survive a reload', async ({ page }) => {
  await uploadPhotos(page, [
    await makeJpeg(page, 600, 400, '#7a3f8f'),
    await makeJpeg(page, 400, 600, '#3f8f7a'),
  ])
  await expect(trayPhoto(page, 'foto-2.jpg')).toBeVisible()
  await addFrame(page, '10×15 cm')
  await trayPhoto(page, 'foto-1.jpg').click()
  await addFrame(page, '13×18 cm')

  await expect
    .poll(async () => {
      const saved = await savedCollection(page)
      return [saved?.frames.length, saved?.frames[0]?.layers.length, saved?.photoIds.length]
    })
    .toEqual([2, 1, 2])

  await page.reload()
  await expect(frame(page, 1, 2)).toBeVisible()
  await expect(frame(page, 2, 2)).toBeVisible()
  await expect(trayPhoto(page, 'foto-1.jpg')).toBeVisible()
  await expect(trayPhoto(page, 'foto-2.jpg')).toBeVisible()
  await expect
    .poll(() =>
      frame(page, 1, 2)
        .locator('img')
        .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
    )
    .toBe(true)
})

test('a full device shows a persistent warning', async ({ page }) => {
  await addFrame(page, '10×15 cm')
  await expect.poll(async () => (await savedCollection(page))?.frames.length).toBe(1)
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('The quota has been exceeded', 'QuotaExceededError')
    }
  })
  await addFrame(page, '13×18 cm')
  const banner = page.getByRole('alert')
  await expect(banner).toContainText('Não foi possível salvar')

  await addFrame(page, '15×21 cm')
  await page.waitForTimeout(1200)
  await expect(banner).toBeVisible()
})

test('a broken file is reported and the good one still comes in', async ({ page }) => {
  const good = await makeJpeg(page, 600, 400, '#b5862b')
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'boa.jpg', mimeType: 'image/jpeg', buffer: good },
    { name: 'quebrada.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not a jpeg') },
  ])
  await expect(trayPhoto(page, 'boa.jpg')).toBeVisible()
  await expect(page.getByText('1 foto não pôde ser lida')).toBeVisible()
  await expect(trayPhoto(page, 'quebrada.jpg')).toHaveCount(0)
})

test('the file input takes several photos of the supported types', async ({ page }) => {
  const input = page.locator('input[type="file"]')
  await expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
  await expect(input).toHaveAttribute('multiple', '')
})

test('the screen never scrolls as a page', async ({ page }) => {
  await uploadPhotos(page, [await makeJpeg(page, 600, 400, '#44617b')])
  await expect(trayPhoto(page, 'foto-1.jpg')).toBeVisible()
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - window.innerWidth,
    y: document.documentElement.scrollHeight - window.innerHeight,
  }))
  expect(overflow).toEqual({ x: 0, y: 0 })
})
