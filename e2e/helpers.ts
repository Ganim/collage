import { devices, test as base, type Page } from '@playwright/test'

const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 15 Pro Max']!

/**
 * Each test gets a fresh on-disk profile. Playwright's default context is ephemeral, and
 * WebKit refuses to keep Blobs in IndexedDB there ("Error preparing Blob/File data").
 */
export const test = base.extend<{ installHint: boolean }>({
  // The suggestion covers the screen on an iPhone's first visit, which is every test's visit.
  installHint: [false, { option: true }],
  context: async ({ playwright, baseURL, installHint }, provide, testInfo) => {
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
      await context.addInitScript(() => localStorage.setItem('collage.installHintDismissed', '1'))
    }
    await provide(context)
    await context.close()
  },
  page: async ({ context }, provide) => {
    await provide(context.pages()[0] ?? (await context.newPage()))
  },
})

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
