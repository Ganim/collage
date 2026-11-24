import { t } from '../i18n'

const MAX_NAME_LENGTH = 120
const REVOKE_DELAY_MS = 60_000

/** The collection name, with only characters every system accepts in a file name. */
export function safeBaseName(collectionName: string): string {
  const trimEnds = (text: string) => text.replace(/^[\s.]+|[\s.]+$/g, '')
  const cleaned = trimEnds(collectionName.replace(/[\\/:*?"<>|\p{Cc}]/gu, ''))
  const name = trimEnds([...cleaned].slice(0, MAX_NAME_LENGTH).join(''))
  return name || t('print.defaultFileName')
}

/** The collection name as a file name, with only characters every system accepts. */
export function safeFileName(collectionName: string, extension: string): string {
  return `${safeBaseName(collectionName)}.${extension}`
}

export const pdfFileName = (collectionName: string) => safeFileName(collectionName, 'pdf')

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // The browser reads the URL after click() returns; iOS can take a while.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}

/**
 * Phones and tablets hand files on through the share sheet; a computer saves them, where the
 * share sheet is only in the way.
 */
export const prefersShareSheet = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

export type DeliverMode = 'share' | 'download'

/** Call straight from a tap: iOS only opens the share sheet right after one. */
export async function deliverFile(
  blob: Blob,
  fileName: string,
  type: string,
  mode: DeliverMode,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], fileName, { type })
  if (mode === 'share' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      console.error(e)
    }
  }
  download(blob, fileName)
  return 'downloaded'
}

export const deliverPdf = (blob: Blob, fileName: string, mode: DeliverMode) =>
  deliverFile(blob, fileName, 'application/pdf', mode)
