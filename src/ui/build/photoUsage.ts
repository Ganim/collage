import type { Frame } from '../../core/types'
import { sizeShortText } from './sizeText'

/** For each photo in a frame: the sizes of its frames ("10×15"), each once, in frame order. */
export function photoUsage(frames: Frame[]): Map<string, string[]> {
  const usage = new Map<string, string[]>()
  for (const frame of frames) {
    const size = sizeShortText(frame)
    for (const { photoId } of frame.layers) {
      const sizes = usage.get(photoId) ?? []
      if (!sizes.includes(size)) sizes.push(size)
      usage.set(photoId, sizes)
    }
  }
  return usage
}

/** "10×15", or "10×15 +1" when the photo is in frames of more sizes. */
export function usageChipText(sizes: string[]): string {
  return sizes.length > 1 ? `${sizes[0]} +${sizes.length - 1}` : (sizes[0] ?? '')
}
