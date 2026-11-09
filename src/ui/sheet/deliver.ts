import { t } from '../i18n'

const MAX_NAME_LENGTH = 120
const REVOKE_DELAY_MS = 60_000

/** The collection name as a file name: only characters every system accepts, ending in .pdf. */
export function pdfFileName(collectionName: string): string {
  const trimEnds = (text: string) => text.replace(/^[\s.]+|[\s.]+$/g, '')
  const cleaned = trimEnds(collectionName.replace(/[\\/:*?"<>|\p{Cc}]/gu, ''))
  const name = trimEnds([...cleaned].slice(0, MAX_NAME_LENGTH).join(''))
  return `${name || t('print.defaultFileName')}.pdf`
}

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

/** Call straight from a tap: iOS only opens the share sheet right after one. */
export async function deliverPdf(
  blob: Blob,
  fileName: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], fileName, { type: 'application/pdf' })
  if (navigator.canShare?.({ files: [file] })) {
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
