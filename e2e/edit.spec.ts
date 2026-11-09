import { expect, type Page } from '@playwright/test'
import { makeJpeg, savedCollection, test, uploadPhotos } from './helpers'

type Point = [number, number]

interface SavedLayer {
  id: string
  photoId: string
  cx: number
  cy: number
  widthFrac: number
  rotationDeg: number
}

const COLORS = ['#a8552f', '#2f5fa8', '#6a8f3a', '#7a3f8f', '#b5862b', '#3f8f7a']

const trayPhoto = (page: Page, position: number) =>
  page.getByRole('button', { name: `Colocar foto-${position}.jpg no frame` })
const theFrame = (page: Page) => page.getByRole('img', { name: 'Frame 1 de 1', exact: true })
const carousel = (page: Page) => page.getByRole('region', { name: 'Frames', exact: true })
const ok = (page: Page) => page.getByRole('button', { name: 'OK', exact: true })
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Ações da foto' })
const action = (page: Page, name: string) => toolbar(page).getByRole('button', { name })
const surface = (page: Page) => page.locator('.edit-surface')
const handles = (page: Page) => page.locator('.edit-handle')
const outline = (page: Page) => page.locator('.edit-outline')

async function box(page: Page) {
  const b = await theFrame(page).boundingBox()
  if (!b) throw new Error('frame is not visible')
  return b
}

/** A portrait frame, so portrait photos do not turn it, with photo 1 as the background. */
async function frameWithBackground(page: Page, photoCount: number) {
  const buffers: Buffer[] = []
  for (let i = 0; i < photoCount; i++) {
    buffers.push(await makeJpeg(page, 400, 600, COLORS[i]!))
  }
  await uploadPhotos(page, buffers)
  await expect(trayPhoto(page, photoCount)).toBeVisible()
  await page.getByRole('button', { name: 'Adicionar frame', exact: true }).click()
  await page.getByRole('button', { name: '10×15 cm', exact: true }).click()
  await trayPhoto(page, 1).click()
  await expect(theFrame(page).locator('img')).toHaveCount(1)
}

async function savedLayers(page: Page): Promise<SavedLayer[]> {
  const saved = await savedCollection(page)
  return (saved?.frames[0]?.layers ?? []) as SavedLayer[]
}

async function tapInFrame(page: Page, fx: number, fy: number) {
  const b = await box(page)
  await page.touchscreen.tap(b.x + b.width * fx, b.y + b.height * fy)
}

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(
      from[0] + ((to[0] - from[0]) * i) / 5,
      from[1] + ((to[1] - from[1]) * i) / 5,
    )
  }
  await page.mouse.up()
}

/** Two fingers, sent as pointer events: a test cannot produce a real multi-touch on the page. */
async function pinch(page: Page, from: [Point, Point], to: [Point, Point]) {
  await surface(page).evaluate(
    (el, { from: start, to: end }) => {
      // Only real pointers can be captured.
      el.setPointerCapture = () => {}
      const fire = (type: string, id: number, [x, y]: number[], buttons: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: id,
            pointerType: 'touch',
            isPrimary: id === 1,
            clientX: x,
            clientY: y,
            buttons,
          }),
        )
      const at = (finger: 0 | 1, k: number) => {
        const a = start[finger]
        const b = end[finger]
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
      }
      fire('pointerdown', 1, at(0, 0), 1)
      fire('pointerdown', 2, at(1, 0), 1)
      for (let k = 1; k <= 8; k++) {
        fire('pointermove', 1, at(0, k / 8), 1)
        fire('pointermove', 2, at(1, k / 8), 1)
      }
      fire('pointerup', 1, at(0, 1), 0)
      fire('pointerup', 2, at(1, 1), 0)
    },
    { from, to },
  )
}

async function expectCovered(page: Page, imageIndex: number) {
  await expect
    .poll(async () => {
      const f = await box(page)
      const i = (await theFrame(page).locator('img').nth(imageIndex).boundingBox())!
      return (
        i.x <= f.x + 1 &&
        i.y <= f.y + 1 &&
        i.x + i.width >= f.x + f.width - 1 &&
        i.y + i.height >= f.y + f.height - 1
      )
    })
    .toBe(true)
}

/** Waits until the autosave holds what `check` wants, and returns the layers. */
async function layersWhen(page: Page, check: (layers: SavedLayer[]) => boolean) {
  await expect.poll(async () => check(await savedLayers(page))).toBe(true)
  return savedLayers(page)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('tapping a frame locks the carousel for editing; OK and tapping outside leave', async ({
  page,
}) => {
  await frameWithBackground(page, 1)
  await expect(ok(page)).toHaveCount(0)
  await expect(carousel(page)).toHaveCSS('overflow-x', 'auto')

  await theFrame(page).tap()
  await expect(ok(page)).toBeVisible()
  await expect(carousel(page)).toHaveCSS('overflow-x', 'hidden')
  await expect(page.getByRole('button', { name: 'Mais opções', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Baixar', exact: true })).toBeVisible()

  await ok(page).click()
  await expect(ok(page)).toHaveCount(0)
  await expect(carousel(page)).toHaveCSS('overflow-x', 'auto')

  await theFrame(page).click()
  await expect(ok(page)).toBeVisible()
  const b = await box(page)
  await page.mouse.click(4, b.y + b.height / 2)
  await expect(ok(page)).toHaveCount(0)
})

test('tapping inside the frame while editing does not leave', async ({ page }) => {
  await frameWithBackground(page, 1)
  await theFrame(page).click()
  await tapInFrame(page, 0.5, 0.5)
  await expect(ok(page)).toBeVisible()
})

test('an empty frame does not enter edit mode', async ({ page }) => {
  await page.getByRole('button', { name: 'Adicionar primeiro frame' }).click()
  await page.getByRole('button', { name: '10×15 cm', exact: true }).click()
  await expect(theFrame(page)).toBeVisible()
  await tapInFrame(page, 0.5, 0.5)
  await expect(ok(page)).toHaveCount(0)
})

test('only the frame blocks the browser touch handling while editing', async ({ page }) => {
  await frameWithBackground(page, 1)
  await theFrame(page).click()
  await expect(surface(page)).toHaveCSS('touch-action', 'none')
  await expect(page.locator('body')).toHaveCSS('touch-action', 'auto')
  await expect(theFrame(page).locator('img')).toHaveAttribute('draggable', 'false')
})

test('an iOS pinch on the frame does not zoom the page', async ({ page }) => {
  await frameWithBackground(page, 1)
  await theFrame(page).click()
  const prevented = await surface(page).evaluate((el) =>
    ['gesturestart', 'gesturechange'].map((type) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      el.dispatchEvent(event)
      return event.defaultPrevented
    }),
  )
  expect(prevented).toEqual([true, true])
})

test('with a background, tapping another photo adds it selected, up to five layers', async ({
  page,
}) => {
  await frameWithBackground(page, 5)
  for (let i = 2; i <= 5; i++) {
    await trayPhoto(page, i).click()
    await expect(ok(page)).toBeVisible()
    await expect(theFrame(page).locator('img')).toHaveCount(i)
    await expect(handles(page)).toHaveCount(4)
    await expect(toolbar(page)).toBeVisible()
    await expect(trayPhoto(page, 1)).toHaveCount(0)
    await ok(page).click()
  }
  const layers = await layersWhen(page, (l) => l.length === 5)
  expect(new Set(layers.map((l) => l.id)).size).toBe(5)
})

test('the bar lists every action with an icon and a label, big enough to touch', async ({
  page,
}) => {
  await frameWithBackground(page, 3)
  await trayPhoto(page, 2).click()
  await expect(toolbar(page)).toBeVisible()

  const items = toolbar(page).locator(':scope > *')
  const labels = ['Trocar', 'Tamanho', 'Girar', 'Adicionar', 'Frente', 'Trás', 'Remover']
  await expect(items).toHaveCount(labels.length)
  for (const [i, label] of labels.entries()) {
    await expect(items.nth(i)).toHaveText(label)
    await expect(items.nth(i).locator('svg')).toHaveCount(1)
    const b = (await items.nth(i).boundingBox())!
    expect(b.width).toBeGreaterThanOrEqual(44)
    expect(b.height).toBeGreaterThanOrEqual(44)
  }
  await expect(page.getByRole('button', { name: /fundo/i })).toHaveCount(0)
})

test('tapping a layer selects it; the background has an outline and no handles', async ({
  page,
}) => {
  await frameWithBackground(page, 2)
  await trayPhoto(page, 2).click()
  await expect(handles(page)).toHaveCount(4)

  await tapInFrame(page, 0.05, 0.05)
  await expect(outline(page)).toHaveCount(1)
  await expect(handles(page)).toHaveCount(0)
  await expect(action(page, 'Frente')).toHaveCount(0)
  await expect(action(page, 'Trás')).toHaveCount(0)

  await tapInFrame(page, 0.5, 0.5)
  await expect(handles(page)).toHaveCount(4)
})

test('a press that jitters a few pixels is still a tap and moves nothing', async ({ page }) => {
  await frameWithBackground(page, 2)
  await trayPhoto(page, 2).click()
  await expect(handles(page)).toHaveCount(4)
  const overlay = theFrame(page).locator('img').nth(1)
  await expect(overlay).toBeVisible()
  const before = await overlay.boundingBox()

  // Back and forth over one pixel: little net movement, about 4 px accumulated.
  const b = await box(page)
  const [x, y] = [b.x + b.width * 0.05, b.y + b.height * 0.05]
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (const dx of [1, 0, 1, 0]) await page.mouse.move(x + dx, y)
  await page.mouse.up()

  await expect(handles(page)).toHaveCount(0)
  await expect(outline(page)).toHaveCount(1)
  expect(await overlay.boundingBox()).toEqual(before)
})

test('a photo read after moving to another frame stays in the tray', async ({ page }) => {
  await frameWithBackground(page, 1)
  await page.getByRole('button', { name: 'Adicionar frame', exact: true }).click()
  await page.getByRole('button', { name: '10×15 cm', exact: true }).click()
  const second = page.getByRole('img', { name: 'Frame 2 de 2', exact: true })
  await expect(second).toBeVisible()
  await trayPhoto(page, 1).click()
  await expect(second.locator('img')).toHaveCount(1)
  await second.click()
  await expect(ok(page)).toBeVisible()

  const fresh = await makeJpeg(page, 400, 600, COLORS[1]!)
  // Holds the import open until the test has changed frames.
  await page.evaluate(() => {
    const subtle = crypto.subtle
    const digest = subtle.digest.bind(subtle)
    const gate = new Promise<void>((resolve) => {
      ;(window as unknown as { releaseImport: () => void }).releaseImport = resolve
    })
    subtle.digest = async (...args: Parameters<typeof digest>) => {
      await gate
      return digest(...args)
    }
  })
  await uploadPhotos(page, [fresh])
  await page.getByRole('button', { name: 'Ir para o frame 1', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Ir para o frame 1', exact: true }),
  ).toHaveAttribute('aria-current', 'true')
  await page.evaluate(() => (window as unknown as { releaseImport: () => void }).releaseImport())

  await expect(page.getByRole('button', { name: 'Colocar foto-1.jpg no frame' })).toHaveCount(2)
  await expect(ok(page)).toHaveCount(0)
  await expect(
    page.getByRole('img', { name: 'Frame 1 de 2', exact: true }).locator('img'),
  ).toHaveCount(1)
  await expect(second.locator('img')).toHaveCount(1)
})

test('a frame opens with its top layer selected', async ({ page }) => {
  await frameWithBackground(page, 2)
  await trayPhoto(page, 2).click()
  await ok(page).click()
  await theFrame(page).click()
  await expect(handles(page)).toHaveCount(4)
})

test('Frente and Trás follow the stacking order', async ({ page }) => {
  await frameWithBackground(page, 3)
  await trayPhoto(page, 2).click()
  await ok(page).click()
  await trayPhoto(page, 3).click()
  const before = await layersWhen(page, (l) => l.length === 3)
  await expect(action(page, 'Frente')).toBeDisabled()
  await expect(action(page, 'Trás')).toBeEnabled()

  await action(page, 'Trás').click()
  await expect(action(page, 'Trás')).toBeDisabled()
  await expect(action(page, 'Frente')).toBeEnabled()
  const after = await layersWhen(page, (l) => l[1]?.id === before[2]?.id)
  expect(after[2]?.id).toBe(before[1]?.id)
  expect(after[0]?.id).toBe(before[0]?.id)
})

test('Girar on the background leaves no corner uncovered', async ({ page }) => {
  await frameWithBackground(page, 1)
  await theFrame(page).click()
  await action(page, 'Girar').click()
  await layersWhen(page, (l) => l[0]?.rotationDeg === 90)
  await expectCovered(page, 0)
})

test('Remover on the background makes the next layer the background', async ({ page }) => {
  await frameWithBackground(page, 2)
  await trayPhoto(page, 2).click()
  const [bg, top] = await layersWhen(page, (l) => l.length === 2)
  await tapInFrame(page, 0.05, 0.05)
  await expect(handles(page)).toHaveCount(0)

  await action(page, 'Remover').click()
  const layers = await layersWhen(page, (l) => l.length === 1)
  expect(layers[0]?.id).toBe(top?.id)
  expect(layers[0]?.id).not.toBe(bg?.id)
  await expect(theFrame(page).locator('img')).toHaveCount(1)
  await expectCovered(page, 0)
  await expect(ok(page)).toBeVisible()
  await expect(outline(page)).toHaveCount(1)
})

test('Adicionar puts the chosen photo on top, even one already in the collection', async ({
  page,
}) => {
  await frameWithBackground(page, 2)
  await theFrame(page).click()
  const fresh = await makeJpeg(page, 400, 600, COLORS[3]!)
  await uploadPhotos(page, [fresh])
  await expect(theFrame(page).locator('img')).toHaveCount(2)
  await expect(handles(page)).toHaveCount(4)

  await uploadPhotos(page, [fresh])
  await expect(theFrame(page).locator('img')).toHaveCount(3)
  const layers = await layersWhen(page, (l) => l.length === 3)
  expect(layers[1]?.photoId).toBe(layers[2]?.photoId)
})

test('Trocar swaps the photo from the tray and can be cancelled', async ({ page }) => {
  await frameWithBackground(page, 2)
  await theFrame(page).click()
  await action(page, 'Trocar').click()
  await expect(page.getByText('Toque numa foto para trocar')).toBeVisible()
  await expect(trayPhoto(page, 2)).toBeVisible()

  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByText('Toque numa foto para trocar')).toHaveCount(0)
  await expect(toolbar(page)).toBeVisible()
  await expect(ok(page)).toBeVisible()

  const [original] = await layersWhen(page, (l) => l.length === 1)
  await action(page, 'Trocar').click()
  await trayPhoto(page, 2).click()
  await expect(toolbar(page)).toBeVisible()
  const layers = await layersWhen(page, (l) => l[0]?.photoId !== original?.photoId)
  expect(layers).toHaveLength(1)
  expect(layers[0]?.id).toBe(original?.id)
})

test('Tamanho opens the size sheet and stays in edit mode', async ({ page }) => {
  await frameWithBackground(page, 1)
  await theFrame(page).click()
  await action(page, 'Tamanho').click()
  await page.getByRole('button', { name: '13×18 cm', exact: true }).click()
  await expect(page.getByRole('button', { name: '13 × 18 cm' })).toBeVisible()
  await expect(ok(page)).toBeVisible()
})

test('the tray and the bar take the same height, so the frame does not jump', async ({ page }) => {
  await frameWithBackground(page, 1)
  const browsing = await box(page)
  await theFrame(page).click()
  await expect(toolbar(page)).toBeVisible()
  expect(await box(page)).toEqual(browsing)
})

test('dragging moves the selected photo during the gesture and is saved', async ({ page }) => {
  await frameWithBackground(page, 2)
  await trayPhoto(page, 2).click()
  const b = await box(page)
  const image = theFrame(page).locator('img').nth(1)
  await expect(image).toBeVisible()
  const start = (await image.boundingBox())!
  const from: Point = [b.x + b.width / 2, b.y + b.height / 2]

  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(from[0] + 30, from[1] - 20)
  await page.mouse.move(from[0] + 60, from[1] - 40)
  const during = (await image.boundingBox())!
  expect(during.x - start.x).toBeGreaterThan(40)
  await page.mouse.up()

  const [, top] = await layersWhen(page, (l) => (l[1]?.cx ?? 0) > 0.55)
  expect(top!.cx).toBeCloseTo(0.5 + 60 / b.width, 1)
  expect(top!.cy).toBeCloseTo(0.5 - 40 / b.height, 1)
  await expect(ok(page)).toBeVisible()
})

test('a drag past the edge stops the centre there and does not leave edit mode', async ({
  page,
}) => {
  await frameWithBackground(page, 2)
  await trayPhoto(page, 2).click()
  const b = await box(page)
  await drag(page, [b.x + b.width / 2, b.y + b.height / 2], [4, b.y + b.height / 2])
  const [, top] = await layersWhen(page, (l) => l[1]?.cx === 0)
  expect(top!.cx).toBe(0)
  await expect(ok(page)).toBeVisible()
})

test('dragging the background never uncovers the frame', async ({ page }) => {
  await frameWithBackground(page, 2)
  await trayPhoto(page, 2).click()
  await tapInFrame(page, 0.05, 0.05)
  await expect(handles(page)).toHaveCount(0)
  const b = await box(page)
  await drag(page, [b.x + 20, b.y + 20], [b.x + b.width - 20, b.y + b.height - 20])
  await expectCovered(page, 0)
})

test('two fingers scale and rotate a photo on top', async ({ page }) => {
  await frameWithBackground(page, 2)
  await trayPhoto(page, 2).click()
  const b = await box(page)
  const c: Point = [b.x + b.width / 2, b.y + b.height / 2]
  await pinch(
    page,
    [
      [c[0] - 40, c[1]],
      [c[0] + 40, c[1]],
    ],
    [
      [c[0], c[1] - 80],
      [c[0], c[1] + 80],
    ],
  )
  const [, top] = await layersWhen(page, (l) => (l[1]?.widthFrac ?? 0) > 0.9)
  expect(top!.widthFrac).toBeCloseTo(1, 1)
  expect(top!.rotationDeg).toBeCloseTo(90, 0)
})

test('two fingers zoom the background without turning it', async ({ page }) => {
  await frameWithBackground(page, 1)
  await theFrame(page).click()
  const [before] = await layersWhen(page, (l) => l.length === 1)
  const b = await box(page)
  const c: Point = [b.x + b.width / 2, b.y + b.height / 2]
  await pinch(
    page,
    [
      [c[0] - 40, c[1]],
      [c[0] + 40, c[1]],
    ],
    [
      [c[0], c[1] - 80],
      [c[0], c[1] + 80],
    ],
  )
  const [after] = await layersWhen(page, (l) => (l[0]?.widthFrac ?? 0) > before!.widthFrac * 1.5)
  expect(after!.rotationDeg).toBe(0)
  await expectCovered(page, 0)
})

test('a corner handle resizes the photo around its centre', async ({ page }) => {
  await frameWithBackground(page, 2)
  await trayPhoto(page, 2).click()
  await expect(handles(page)).toHaveCount(4)
  const b = await box(page)
  const corner = (await handles(page).nth(3).boundingBox())!
  const grab: Point = [corner.x + corner.width / 2, corner.y + corner.height / 2]
  const c: Point = [b.x + b.width / 2, b.y + b.height / 2]
  await drag(page, grab, [c[0] + (grab[0] - c[0]) * 1.5, c[1] + (grab[1] - c[1]) * 1.5])

  const [, top] = await layersWhen(page, (l) => (l[1]?.widthFrac ?? 0) > 0.6)
  expect(top!.widthFrac).toBeCloseTo(0.75, 1)
  expect(top!.cx).toBeCloseTo(0.5)
})
