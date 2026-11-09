import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { expect, type Download, type Page } from '@playwright/test'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { makeJpeg, savedCollection, test, uploadPhotos } from './helpers'

const COLORS = ['#a8552f', '#2f5fa8', '#6a8f3a', '#7a3f8f', '#b5862b', '#3f8f7a']

const trayPhoto = (page: Page, position: number) =>
  page.getByRole('button', { name: `Colocar foto-${position}.jpg no frame` })
const generateButton = (page: Page) => page.getByRole('button', { name: 'Gerar PDF', exact: true })
const saveButton = (page: Page) => page.getByRole('button', { name: 'Salvar PDF', exact: true })
const sheets = (page: Page) => page.getByRole('group', { name: /^Folha \d+ de \d+$/ })

async function uploadSized(page: Page, count: number, w: number, h: number) {
  const buffers: Buffer[] = []
  for (let i = 0; i < count; i++) buffers.push(await makeJpeg(page, w, h, COLORS[i]!))
  await uploadPhotos(page, buffers)
  await expect(trayPhoto(page, count)).toBeVisible()
}

async function addFrameWithPhoto(page: Page, preset: string, photo: number, position: number) {
  await page.getByRole('button', { name: 'Adicionar frame', exact: true }).click()
  await page.getByRole('button', { name: preset, exact: true }).click()
  await trayPhoto(page, photo).click()
  await expect(
    page.getByRole('img', { name: `Frame ${position} de ${position}`, exact: true }).locator('img'),
  ).toHaveCount(1)
}

/** One 10×15 cm frame per photo, each photo big enough to need downscaling. */
async function photoFrames(page: Page, count: number) {
  await uploadSized(page, count, 1600, 2400)
  for (let i = 1; i <= count; i++) await addFrameWithPhoto(page, '10×15 cm', i, i)
}

const openSheet = (page: Page) => page.getByRole('button', { name: 'Baixar', exact: true }).click()

async function generated(page: Page) {
  await expect(generateButton(page)).toBeEnabled()
  await generateButton(page).click()
  await expect(saveButton(page)).toBeVisible({ timeout: 25_000 })
}

async function savedPaper(page: Page) {
  return (await savedCollection(page))?.paper
}

/** Removes a stored photo, leaving the collection pointing at it. */
async function deleteStoredPhoto(page: Page, photoId: string) {
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('collage')
        open.onerror = () => reject(new Error('could not open the database'))
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('photos', 'readwrite')
          tx.objectStore('photos').delete(id)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    photoId,
  )
}

/** Replaces a stored original with bytes no decoder can read. */
async function corruptStoredPhoto(page: Page, photoId: string) {
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('collage')
        open.onerror = () => reject(new Error('could not open the database'))
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('photos', 'readwrite')
          const store = tx.objectStore('photos')
          const got = store.get(id)
          got.onsuccess = () => {
            store.put({
              ...(got.result as object),
              original: new Blob(['not an image'], { type: 'image/jpeg' }),
            })
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    photoId,
  )
}

async function firstLayerPhotoId(page: Page): Promise<string> {
  await expect
    .poll(async () => (await savedCollection(page))?.frames[0]?.layers.length ?? 0)
    .toBeGreaterThan(0)
  const saved = await savedCollection(page)
  return (saved!.frames[0]!.layers[0] as { photoId: string }).photoId
}

async function readPdf(download: Download) {
  const bytes = await readFile(await download.path())
  return PDFDocument.load(bytes)
}

function rawStreams(doc: PDFDocument): PDFRawStream[] {
  return doc.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter((object): object is PDFRawStream => object instanceof PDFRawStream)
}

function embeddedJpegs(doc: PDFDocument): Buffer[] {
  return rawStreams(doc)
    .filter((s) => s.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
    .filter((s) => s.dict.get(PDFName.of('Filter')) === PDFName.of('DCTDecode'))
    .map((s) => Buffer.from(s.contents))
}

/** The width and height each image is painted at, read from the page's drawing commands. */
function drawnImageSizes(doc: PDFDocument): { width: number; height: number }[] {
  const sizes: { width: number; height: number }[] = []
  for (const stream of rawStreams(doc)) {
    if (stream.dict.get(PDFName.of('Filter')) !== PDFName.of('FlateDecode')) continue
    const text = inflateSync(Buffer.from(stream.contents)).toString('latin1')
    const painted = /([\d.]+) 0 0 ([\d.]+) 0 0 cm\s+1 0 0 1 0 0 cm\s+\/\S+ Do/g
    for (const match of text.matchAll(painted)) {
      sizes.push({ width: Number(match[1]), height: Number(match[2]) })
    }
  }
  return sizes
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('two 10×15 frames fit one A4, and the PDF is that exact physical size', async ({ page }) => {
  await photoFrames(page, 2)
  await openSheet(page)

  await expect(page.getByText('1 folha · 48%', { exact: true })).toBeVisible()
  await expect(sheets(page)).toHaveCount(1)
  await generated(page)

  const downloading = page.waitForEvent('download')
  await saveButton(page).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/\.pdf$/)

  const doc = await readPdf(download)
  expect(doc.getPageCount()).toBe(1)
  const { width, height } = doc.getPage(0).getSize()
  expect(width).toBeCloseTo(595.28, 2)
  expect(height).toBeCloseTo(841.89, 2)

  const jpegs = embeddedJpegs(doc)
  expect(jpegs).toHaveLength(2)
  for (const jpeg of jpegs) {
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    expect([...jpeg.subarray(-2)]).toEqual([0xff, 0xd9])
    expect(jpeg.length).toBeGreaterThan(5000)
  }

  const drawn = drawnImageSizes(doc)
  expect(drawn).toHaveLength(2)
  for (const size of drawn) {
    expect(size.width).toBeCloseTo(283.46, 2)
    expect(size.height).toBeCloseTo(425.2, 2)
  }
})

test('generating and saving are two distinct taps', async ({ page }) => {
  await photoFrames(page, 1)
  await openSheet(page)
  const downloads: Download[] = []
  page.on('download', (d) => downloads.push(d))

  await generated(page)
  await expect(generateButton(page)).toHaveCount(0)
  expect(downloads).toHaveLength(0)

  const downloading = page.waitForEvent('download')
  await saveButton(page).click()
  await downloading
})

test('the button shows progress as "N de M" while generating', async ({ page }) => {
  await photoFrames(page, 2)
  await openSheet(page)
  await expect(generateButton(page)).toBeEnabled()
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { progress: string[] }).progress = seen
    new MutationObserver(() => {
      const text = document.querySelector('.print-action')?.textContent
      if (text) seen.push(text)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  await generateButton(page).click()
  await expect(saveButton(page)).toBeVisible({ timeout: 25_000 })
  const progress = await page.evaluate(() => (window as unknown as { progress: string[] }).progress)
  expect(progress).toContain('1 de 2')
})

test('the PDF is named after the collection without characters files cannot hold', async ({
  page,
}) => {
  await photoFrames(page, 1)
  await openSheet(page)
  await generated(page)
  const downloading = page.waitForEvent('download')
  await saveButton(page).click()
  const name = (await downloading).suggestedFilename()
  expect(name).toMatch(/^Fotos de .+\.pdf$/)
  expect(name).not.toMatch(/[\\/:*?"<>|]/)
})

test('choosing A3 lays the frames out again', async ({ page }) => {
  await photoFrames(page, 3)
  await openSheet(page)
  await expect(page.getByText(/^2 folhas · \d+%$/)).toBeVisible()
  await expect(sheets(page)).toHaveCount(2)

  await page.getByRole('combobox', { name: 'Papel' }).selectOption('a3')
  await expect(page.getByText(/^1 folha · \d+%$/)).toBeVisible()
  await expect(sheets(page)).toHaveCount(1)
  await expect.poll(() => savedPaper(page)).toMatchObject({ widthMm: 297, heightMm: 420 })
})

test('Personalizado reveals width and height, read in cm with a comma', async ({ page }) => {
  await photoFrames(page, 1)
  await openSheet(page)
  await expect(page.getByLabel('Largura (cm)')).toHaveCount(0)

  await page.getByRole('combobox', { name: 'Papel' }).selectOption('custom')
  await expect(page.getByLabel('Largura (cm)')).toHaveValue('21')
  await page.getByLabel('Largura (cm)').fill('25,5')
  await page.getByLabel('Altura (cm)').fill('30')
  await expect.poll(() => savedPaper(page)).toMatchObject({ widthMm: 255, heightMm: 300 })
})

test('margin and gap accept a comma; an unusable value blocks generation', async ({ page }) => {
  await photoFrames(page, 1)
  await openSheet(page)
  await expect(generateButton(page)).toBeEnabled()

  await page.getByLabel('Margem (mm)').fill('12,5')
  await page.getByLabel('Espaço (mm)').fill('1,5')
  await expect.poll(() => savedPaper(page)).toMatchObject({ marginMm: 12.5, gapMm: 1.5 })

  await page.getByLabel('Margem (mm)').fill('abc')
  await expect(page.getByLabel('Margem (mm)')).toHaveAttribute('aria-invalid', 'true')
  await expect(generateButton(page)).toBeDisabled()
  expect((await savedPaper(page))?.marginMm).toBe(12.5)
})

test('changing the paper after generating asks to generate again', async ({ page }) => {
  await photoFrames(page, 1)
  await openSheet(page)
  await generated(page)

  await page.getByLabel('Margem (mm)').fill('8')
  await expect(saveButton(page)).toHaveCount(0)
  await expect(generateButton(page)).toBeEnabled()
})

test('rotated frames are drawn turned, in their true position', async ({ page }) => {
  await photoFrames(page, 2)
  await openSheet(page)
  await expect(sheets(page)).toHaveCount(1)

  const sheet = (await sheets(page).boundingBox())!
  const scale = sheet.width / 210
  const frame = page.getByRole('img', { name: 'Frame 1 de 2', exact: true })
  const box = (await frame.boundingBox())!
  // Both 10×15 frames lie on their side to share an A4.
  expect(box.width).toBeCloseTo(150 * scale, 0)
  expect(box.height).toBeCloseTo(100 * scale, 0)
  expect(box.x).toBeGreaterThanOrEqual(sheet.x)
  expect(box.x + box.width).toBeLessThanOrEqual(sheet.x + sheet.width)
})

test('several sheets scroll vertically', async ({ page }) => {
  await uploadSized(page, 4, 1600, 2400)
  for (let i = 1; i <= 4; i++) await addFrameWithPhoto(page, '15×21 cm', i, i)
  await openSheet(page)
  await expect(sheets(page)).toHaveCount(4)

  const scroller = page.locator('.print-scroll')
  const before = (await sheets(page).nth(3).boundingBox())!
  expect(before.y).toBeGreaterThan(page.viewportSize()!.height)
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect
    .poll(async () => (await sheets(page).nth(3).boundingBox())!.y)
    .toBeLessThan(page.viewportSize()!.height)
})

test('an empty frame stays off the sheet with a notice', async ({ page }) => {
  await photoFrames(page, 1)
  await page.getByRole('button', { name: 'Adicionar frame', exact: true }).click()
  await page.getByRole('button', { name: '10×15 cm', exact: true }).click()
  await openSheet(page)

  await expect(page.getByText('1 frame vazio não vai para a folha')).toBeVisible()
  await expect(page.getByText('1 folha · 24%', { exact: true })).toBeVisible()
  await expect(generateButton(page)).toBeEnabled()
})

test('only empty frames: nothing to generate', async ({ page }) => {
  await page.getByRole('button', { name: 'Adicionar primeiro frame' }).click()
  await page.getByRole('button', { name: '10×15 cm', exact: true }).click()
  await openSheet(page)

  await expect(page.getByText('1 frame vazio não vai para a folha')).toBeVisible()
  await expect(page.getByText('0 folhas · 0%', { exact: true })).toBeVisible()
  await expect(generateButton(page)).toBeDisabled()
})

test('a low resolution photo warns, names the frame and does not block', async ({ page }) => {
  await uploadSized(page, 1, 200, 300)
  await addFrameWithPhoto(page, '10×15 cm', 1, 1)
  await openSheet(page)

  await expect(page.getByText('1 foto com baixa resolução: frame 1')).toBeVisible()
  await generated(page)
})

test('a frame larger than the paper is an error and blocks generation', async ({ page }) => {
  await uploadSized(page, 1, 1200, 1200)
  await page.getByRole('button', { name: 'Adicionar frame', exact: true }).click()
  await page.getByLabel('Largura (cm)').fill('30')
  await page.getByLabel('Altura (cm)').fill('30')
  await page.getByRole('button', { name: 'Usar este tamanho' }).click()
  await trayPhoto(page, 1).click()
  await expect(
    page.getByRole('img', { name: 'Frame 1 de 1', exact: true }).locator('img'),
  ).toHaveCount(1)
  await openSheet(page)

  await expect(page.getByText(/O frame 1 não cabe neste papel/)).toBeVisible()
  await expect(generateButton(page)).toBeDisabled()

  // A paper it fits on clears the error.
  await page.getByRole('combobox', { name: 'Papel' }).selectOption('custom')
  await page.getByLabel('Largura (cm)').fill('40')
  await page.getByLabel('Altura (cm)').fill('40')
  await expect(page.getByText('1 folha · 56%', { exact: true })).toBeVisible()
  await expect(page.getByText(/não cabe neste papel/)).toHaveCount(0)
  await expect(generateButton(page)).toBeEnabled()
})

test('a photo gone from storage is flagged and blocks generation', async ({ page }) => {
  await photoFrames(page, 1)
  const photoId = await firstLayerPhotoId(page)
  await deleteStoredPhoto(page, photoId)

  // No reload: the check has to look in storage, not at what the editor remembers.
  await openSheet(page)
  await expect(page.getByText(/A foto do frame 1 não foi encontrada/)).toBeVisible()
  await expect(
    page.getByRole('img', { name: /^Frame 1 de 1/ }).getByText('Foto não encontrada'),
  ).toBeVisible()
  await expect(generateButton(page)).toBeDisabled()

  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  const slide = page.getByRole('img', { name: /^Frame 1 de 1/ })
  await expect(slide.getByText('Foto não encontrada')).toBeVisible()

  await page.reload()
  await expect(slide.getByText('Foto não encontrada')).toBeVisible()
})

test('a generation failure shows a message and returns to Gerar PDF', async ({ page }) => {
  await photoFrames(page, 1)
  const photoId = await firstLayerPhotoId(page)
  await corruptStoredPhoto(page, photoId)
  await openSheet(page)
  await expect(generateButton(page)).toBeEnabled()

  await generateButton(page).click()
  await expect(page.getByText('Não foi possível gerar o PDF. Tente de novo.')).toBeVisible({
    timeout: 25_000,
  })
  await expect(generateButton(page)).toBeEnabled()
})

test('the real size instruction appears once', async ({ page }) => {
  await photoFrames(page, 1)
  await openSheet(page)
  await expect(page.getByText(/tamanho real \(100%\)/)).toHaveCount(1)
  await expect(page.getByText(/tamanho real \(100%\)/)).toBeVisible()
})

test('back returns to the carousel as it was, and edit mode is left on the way', async ({
  page,
}) => {
  await photoFrames(page, 2)
  await page.getByRole('img', { name: 'Frame 2 de 2', exact: true }).click()
  await expect(page.getByRole('button', { name: 'OK', exact: true })).toBeVisible()

  await openSheet(page)
  await expect(page.getByText(/^1 folha/)).toBeVisible()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()

  await expect(page.getByRole('button', { name: 'OK', exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Ir para o frame 2', exact: true }),
  ).toHaveAttribute('aria-current', 'true')
  await expect(
    page.getByRole('img', { name: 'Frame 2 de 2', exact: true }).locator('img'),
  ).toHaveCount(1)
})

test.describe('sharing', () => {
  async function mockShare(page: Page, behaviour: 'ok' | 'abort' | 'fail') {
    await page.evaluate((mode) => {
      const record: { name: string; type: string; size: number }[] = []
      ;(window as unknown as { shared: typeof record }).shared = record
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async ({ files }: { files: File[] }) => {
          const file = files[0]!
          record.push({ name: file.name, type: file.type, size: file.size })
          if (mode === 'abort') throw new DOMException('dismissed', 'AbortError')
          if (mode === 'fail') throw new DOMException('refused', 'NotAllowedError')
        },
      })
    }, behaviour)
  }

  const sharedFiles = (page: Page) =>
    page.evaluate(() => (window as unknown as { shared: { name: string; size: number }[] }).shared)

  test('hands the PDF to the share sheet when the device can share it', async ({ page }) => {
    await photoFrames(page, 1)
    await openSheet(page)
    await generated(page)
    await mockShare(page, 'ok')
    const downloads: Download[] = []
    page.on('download', (d) => downloads.push(d))

    await saveButton(page).click()
    await expect.poll(async () => (await sharedFiles(page)).length).toBe(1)
    const [file] = await sharedFiles(page)
    expect(file!.name).toMatch(/\.pdf$/)
    expect(file!.size).toBeGreaterThan(5000)
    expect(downloads).toHaveLength(0)
  })

  test('cancelling the share sheet downloads nothing and keeps Salvar PDF', async ({ page }) => {
    await photoFrames(page, 1)
    await openSheet(page)
    await generated(page)
    await mockShare(page, 'abort')
    const downloads: Download[] = []
    page.on('download', (d) => downloads.push(d))

    await saveButton(page).click()
    await expect.poll(async () => (await sharedFiles(page)).length).toBe(1)
    await expect(saveButton(page)).toBeEnabled()
    expect(downloads).toHaveLength(0)
    await expect(page.getByText('Não foi possível')).toHaveCount(0)
  })

  test('falls back to a download when sharing fails', async ({ page }) => {
    await photoFrames(page, 1)
    await openSheet(page)
    await generated(page)
    await mockShare(page, 'fail')

    const downloading = page.waitForEvent('download')
    await saveButton(page).click()
    expect((await downloading).suggestedFilename()).toMatch(/\.pdf$/)
  })
})
