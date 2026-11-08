import type { Photo } from '../core/types'
import type { Store } from '../storage/store'

export const ACCEPT = 'image/jpeg,image/png,image/webp'
const PREVIEW_SIDE = 1600
const THUMB_SIDE = 256
const JPEG_QUALITY = 0.9

export interface Decoded {
  width: number
  height: number
  preview: Blob
  thumb: Blob
}

export type Decode = (file: File) => Promise<Decoded>

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function draw(canvas: OffscreenCanvas | HTMLCanvasElement, bitmap: ImageBitmap): void {
  const ctx = canvas.getContext('2d') as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
}

async function scaledJpeg(bitmap: ImageBitmap, maxSide: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    draw(canvas, bitmap)
    return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
  }
  // Not every WebKit build has OffscreenCanvas.
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  draw(canvas, bitmap)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

/** Browser decoder. createImageBitmap applies the EXIF orientation. */
export const decodeImage: Decode = async (file) => {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    return {
      width: bitmap.width,
      height: bitmap.height,
      preview: await scaledJpeg(bitmap, PREVIEW_SIDE),
      thumb: await scaledJpeg(bitmap, THUMB_SIDE),
    }
  } finally {
    bitmap.close()
  }
}

/**
 * Stores each file once (the id is the SHA-256 of its bytes). A file that cannot be
 * decoded is reported in `failed` and the rest carry on; storage errors propagate.
 */
export async function importPhotos(
  files: File[],
  store: Store,
  decode: Decode = decodeImage,
): Promise<{ photos: Photo[]; failed: string[] }> {
  const photos = new Map<string, Photo>()
  const failed: string[] = []
  for (const file of files) {
    let id: string
    let decoded: Decoded
    try {
      id = await sha256Hex(file)
      if (photos.has(id)) continue
      const existing = await store.getPhotosMeta([id])
      const known = existing[id]
      if (known) {
        photos.set(id, known)
        continue
      }
      decoded = await decode(file)
    } catch {
      failed.push(file.name)
      continue
    }
    await store.putPhoto({
      id,
      width: decoded.width,
      height: decoded.height,
      name: file.name,
      original: file,
      preview: decoded.preview,
      thumb: decoded.thumb,
    })
    photos.set(id, { id, width: decoded.width, height: decoded.height, name: file.name })
  }
  return { photos: [...photos.values()], failed }
}
