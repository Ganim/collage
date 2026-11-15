import { describe, expect, it } from 'vitest'
import { DriveAuthError } from '../ui/account/account'
import { DriveError } from './drive'
import { createFakeDrive } from './fakeDrive'
import { createPdfLink, linkFailure, pdfLinkName, sharePdf } from './pdfLink'

const pdf = () => new Blob(['%PDF-1.7'], { type: 'application/pdf' })

describe('pdfLinkName', () => {
  it('stamps the collection name with the local date and time, zero-padded', () => {
    expect(pdfLinkName('Viagem', new Date(2026, 2, 5, 9, 7))).toBe('Viagem - 05-03-2026 09.07.pdf')
  })

  it('keeps only characters every system accepts, with a default name', () => {
    expect(pdfLinkName('a/b: c?', new Date(2026, 10, 15, 18, 30))).toBe(
      'ab c - 15-11-2026 18.30.pdf',
    )
    expect(pdfLinkName('  ', new Date(2026, 10, 15, 18, 30))).toBe('Colagem - 15-11-2026 18.30.pdf')
  })
})

describe('sharePdf', () => {
  it('uploads the PDF to the folder, shares it with anyone and returns the link', async () => {
    const drive = createFakeDrive()
    const body = pdf()
    const link = await sharePdf(drive, 'folder-9', 'Viagem - 05-03-2026 09.07.pdf', body)
    const [file] = [...drive.files.values()]
    expect(file).toMatchObject({
      name: 'Viagem - 05-03-2026 09.07.pdf',
      parents: ['folder-9'],
      appProperties: { kind: 'pdf' },
      permissions: [{ role: 'reader', type: 'anyone' }],
    })
    expect(file!.body).toBe(body)
    expect(link).toBe(`https://drive.google.com/file/d/${file!.id}/view`)
  })

  it('sends the copy to the trash when it cannot be shared', async () => {
    const drive = createFakeDrive()
    const refused = new DriveError('other', 'refused', 403)
    drive.share = () => Promise.reject(refused)
    await expect(sharePdf(drive, 'f', 'x.pdf', pdf())).rejects.toBe(refused)
    expect([...drive.files.values()].map((f) => f.trashed)).toEqual([true])
  })

  it('sends a PDF type even when the Blob has none', async () => {
    const drive = createFakeDrive()
    await sharePdf(drive, 'f', 'x.pdf', new Blob(['%PDF']))
    expect([...drive.files.values()][0]!.body.type).toBe('application/pdf')
  })
})

describe('createPdfLink', () => {
  it('puts the PDF in the PDFs subfolder of the Collage folder', async () => {
    const drive = createFakeDrive()
    await createPdfLink(drive, 'Viagem', pdf(), new Date(2026, 0, 2, 3, 4))
    const pdfs = drive.subfolders.get('PDFs')
    expect(pdfs).toBeDefined()
    expect([...drive.files.values()].map((f) => [f.name, f.parents])).toEqual([
      ['Viagem - 02-01-2026 03.04.pdf', [pdfs]],
    ])
  })
})

describe('linkFailure', () => {
  it('asks to connect the Drive when the person must act, and says failed otherwise', () => {
    expect(linkFailure(new DriveAuthError('no_drive'))).toBe('needsDrive')
    expect(linkFailure(new DriveAuthError('revoked'))).toBe('needsDrive')
    expect(linkFailure(new DriveAuthError('signed_out'))).toBe('needsDrive')
    expect(linkFailure(new DriveError('revoked', 'x', 401))).toBe('needsDrive')
    expect(linkFailure(new DriveError('offline', 'x'))).toBe('failed')
    expect(linkFailure(new DriveError('full', 'x', 403))).toBe('failed')
    expect(linkFailure(new Error('x'))).toBe('failed')
  })
})
