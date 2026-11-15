import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPdfLink } from '../../sync/pdfLink'
import { PdfLinkSection } from './PdfLinkSection'

vi.mock('../../sync/useSync', () => ({ createAppDrive: () => ({}) }))
vi.mock('../../sync/pdfLink', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../sync/pdfLink')>()),
  createPdfLink: vi.fn(),
}))

const LINK = 'https://drive.google.com/file/d/F1/view'
const HINT = 'Toque de novo em Compartilhar para abrir as opções.'

const share = vi.fn<(data: ShareData) => Promise<void>>()

beforeEach(() => {
  vi.mocked(createPdfLink).mockReset().mockResolvedValue(LINK)
  share.mockReset()
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  delete (navigator as Partial<Navigator>).share
  vi.restoreAllMocks()
})

async function tapShare(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Compartilhar link do PDF' }))
    await Promise.resolve()
  })
}

describe('PdfLinkSection', () => {
  it('asks for a second tap when the share sheet is refused after the upload', async () => {
    // iOS: the tap's permission to open the share sheet expired while the PDF went up.
    share.mockRejectedValueOnce(new DOMException('gesture expired', 'NotAllowedError'))
    render(<PdfLinkSection pdf={new Blob(['%PDF-'])} collectionName="Viagem" />)

    await tapShare()
    expect(await screen.findByText(HINT)).toBeInTheDocument()
    expect(screen.getByDisplayValue(LINK)).toBeInTheDocument()

    // The second tap reuses the link and opens the sheet; the hint goes away.
    share.mockResolvedValueOnce(undefined)
    await tapShare()
    expect(createPdfLink).toHaveBeenCalledTimes(1)
    expect(share).toHaveBeenLastCalledWith({ title: 'Viagem', url: LINK })
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('shows no hint when the person just closes the share sheet', async () => {
    share.mockRejectedValueOnce(new DOMException('closed', 'AbortError'))
    render(<PdfLinkSection pdf={new Blob(['%PDF-'])} collectionName="Viagem" />)

    await tapShare()
    expect(await screen.findByDisplayValue(LINK)).toBeInTheDocument()
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })
})
