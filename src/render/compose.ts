import type { Frame, Layer, Photo, Size } from '../core/types'
import type { StoredPhoto } from '../storage/store'

const DPI = 300
const JPEG_QUALITY = 0.92

export class MissingPhotoError extends Error {
  readonly frameIds: string[]

  constructor(frameIds: string[]) {
    super(`Missing photos in frames: ${frameIds.join(', ')}`)
    this.name = 'MissingPhotoError'
    this.frameIds = frameIds
  }
}

export interface RasterCanvas {
  context: Pick<
    OffscreenCanvasRenderingContext2D,
    | 'fillStyle'
    | 'fillRect'
    | 'save'
    | 'restore'
    | 'translate'
    | 'rotate'
    | 'drawImage'
    | 'imageSmoothingEnabled'
    | 'imageSmoothingQuality'
  >
  exportJpeg(quality: number): Promise<Uint8Array>
  /** iOS keeps canvas memory until the backing store is shrunk. */
  release(): void
}

/** The only part of composition that needs a browser canvas. */
export interface Raster {
  /** With resizeWidth, decodes straight to that width instead of the photo's full size. */
  decode(blob: Blob, resizeWidth?: number): Promise<ImageBitmap>
  createCanvas(width: number, height: number): RasterCanvas
}

function offscreenCanvas(width: number, height: number): RasterCanvas {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  return {
    context,
    async exportJpeg(quality) {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
      return new Uint8Array(await blob.arrayBuffer())
    },
    release() {
      canvas.width = 0
      canvas.height = 0
    },
  }
}

function domCanvas(width: number, height: number): RasterCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  return {
    context,
    async exportJpeg(quality) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      )
      if (!blob) throw new Error('Canvas export failed')
      return new Uint8Array(await blob.arrayBuffer())
    },
    release() {
      canvas.width = 0
      canvas.height = 0
    },
  }
}

export const browserRaster: Raster = {
  decode: (blob, resizeWidth) =>
    createImageBitmap(
      blob,
      resizeWidth === undefined
        ? { imageOrientation: 'from-image' }
        : { imageOrientation: 'from-image', resizeWidth, resizeQuality: 'high' },
    ),
  // Not every WebKit build has OffscreenCanvas.
  createCanvas: (width, height) =>
    typeof OffscreenCanvas === 'undefined'
      ? domCanvas(width, height)
      : offscreenCanvas(width, height),
}

const mmToPx = (mm: number): number => Math.round((mm / 25.4) * DPI)

export function frameCanvasSize(frame: Size): { width: number; height: number } {
  return { width: mmToPx(frame.widthMm), height: mmToPx(frame.heightMm) }
}

export function layerDrawRect(
  layer: Layer,
  photo: Photo,
  canvas: { width: number; height: number },
): { cx: number; cy: number; w: number; h: number; rad: number } {
  const w = layer.widthFrac * canvas.width
  return {
    cx: layer.cx * canvas.width,
    cy: layer.cy * canvas.height,
    w,
    h: (w * photo.height) / photo.width,
    rad: (layer.rotationDeg * Math.PI) / 180,
  }
}

/** Paints a frame on white from its layers' originals; each bitmap is closed before the next is decoded. */
export async function composeFrame(
  frame: Frame,
  loadPhoto: (photoId: string) => Promise<StoredPhoto>,
  raster: Raster,
): Promise<Uint8Array> {
  const size = frameCanvasSize(frame)
  const canvas = raster.createCanvas(size.width, size.height)
  try {
    const { context } = canvas
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size.width, size.height)

    for (const layer of frame.layers) {
      const photo = await loadPhoto(layer.photoId)
      const { cx, cy, w, h, rad } = layerDrawRect(layer, photo, size)
      // A reduced decode spares memory: a 48 MP photo would otherwise take about 190 MB.
      const drawnWidth = Math.ceil(w)
      const bitmap = await raster.decode(
        photo.original,
        drawnWidth < photo.width ? drawnWidth : undefined,
      )
      try {
        context.save()
        context.translate(cx, cy)
        context.rotate(rad)
        context.drawImage(bitmap, -w / 2, -h / 2, w, h)
        context.restore()
      } finally {
        bitmap.close()
      }
    }
    return await canvas.exportJpeg(JPEG_QUALITY)
  } finally {
    canvas.release()
  }
}
