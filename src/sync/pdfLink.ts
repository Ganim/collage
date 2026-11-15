import { DriveAuthError } from '../ui/account/account'
import { safeBaseName } from '../ui/sheet/deliver'
import { DriveError, type Drive } from './drive'

/** The subfolder of the Collage folder that holds the shared PDFs. */
export const PDF_FOLDER = 'PDFs'
const PDF_TYPE = 'application/pdf'

const pad = (n: number) => String(n).padStart(2, '0')

/** `<collection name> - dd-mm-aaaa hh.mm.pdf`, in local time. */
export function pdfLinkName(collectionName: string, at: Date): string {
  const date = `${pad(at.getDate())}-${pad(at.getMonth() + 1)}-${at.getFullYear()}`
  const time = `${pad(at.getHours())}.${pad(at.getMinutes())}`
  return `${safeBaseName(collectionName)} - ${date} ${time}.pdf`
}

/** Uploads the PDF to the folder, lets anyone with the link read it, and returns the link. */
export async function sharePdf(
  drive: Drive,
  folderId: string,
  name: string,
  pdf: Blob,
): Promise<string> {
  const body = pdf.type === PDF_TYPE ? pdf : new Blob([pdf], { type: PDF_TYPE })
  const file = await drive.create(folderId, name, body, { kind: 'pdf' })
  try {
    return await drive.share(file.id)
  } catch (e) {
    // A copy nobody can open is no use; trying again uploads a new one.
    await drive.trash(file.id).catch((trashError: unknown) => console.error(trashError))
    throw e
  }
}

/** The link to a new copy of the PDF in the `PDFs` folder, named after the collection and now. */
export async function createPdfLink(
  drive: Drive,
  collectionName: string,
  pdf: Blob,
  at: Date = new Date(),
): Promise<string> {
  const folder = await drive.ensureSubfolder(PDF_FOLDER)
  return sharePdf(drive, folder, pdfLinkName(collectionName, at), pdf)
}

/** Whether only the person can fix it (connect the Drive again) or trying again may work. */
export function linkFailure(e: unknown): 'needsDrive' | 'failed' {
  if (e instanceof DriveAuthError) return 'needsDrive'
  if (e instanceof DriveError && e.kind === 'revoked') return 'needsDrive'
  return 'failed'
}
