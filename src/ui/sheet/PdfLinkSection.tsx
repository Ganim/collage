import { Copy, Link2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { createPdfLink, linkFailure } from '../../sync/pdfLink'
import { useSyncStatus, type SyncStatus } from '../../sync/status'
import { createAppDrive } from '../../sync/useSync'
import { signIn } from '../account/account'
import { t } from '../i18n'

type Phase = 'idle' | 'creating' | 'failed' | 'needsDrive' | { link: string }

const driveMissing = (s: SyncStatus) =>
  s.state === 'needsDrive' || (s.state === 'error' && s.error === 'revoked')

/**
 * Opens the share sheet where there is one; a person closing it is not an error. True when the
 * browser refused to open it (NotAllowedError): on iOS the tap no longer counts once the upload
 * took a while, and only a new tap can open it.
 */
async function openShareSheet(title: string, url: string): Promise<boolean> {
  if (typeof navigator.share !== 'function') return false
  try {
    await navigator.share({ title, url })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotAllowedError') return true
    if (!(e instanceof DOMException && e.name === 'AbortError')) console.error(e)
  }
  return false
}

/**
 * Puts the PDF already generated on the screen in the Drive's `PDFs` folder and hands out a
 * link anyone can open. Mount it with a key per PDF: a new PDF needs a new link.
 */
export function PdfLinkSection({ pdf, collectionName }: { pdf: Blob; collectionName: string }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [copied, setCopied] = useState(false)
  const [tapAgain, setTapAgain] = useState(false)
  const statusMissing = useSyncStatus(driveMissing)
  const creating = useRef(false)
  const field = useRef<HTMLInputElement>(null)
  const link = typeof phase === 'object' ? phase.link : null

  const share = async () => {
    // One file per PDF: once there is a link, sharing again reuses it.
    if (link) {
      setTapAgain(false)
      setTapAgain(await openShareSheet(collectionName, link))
      return
    }
    if (creating.current) return
    creating.current = true
    setPhase('creating')
    try {
      const url = await createPdfLink(createAppDrive(), collectionName, pdf)
      setPhase({ link: url })
      setTapAgain(await openShareSheet(collectionName, url))
    } catch (e) {
      console.error(e)
      setPhase(linkFailure(e))
    } finally {
      creating.current = false
    }
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch (e) {
      console.error(e)
      setCopied(false)
      // The person can still copy it by hand.
      field.current?.focus()
      field.current?.select()
    }
  }

  if (!link && (phase === 'needsDrive' || (statusMissing && phase !== 'creating'))) {
    return (
      <section className="pdf-link">
        <p className="pdf-link-hint print-row">{t('pdfLink.needsDrive')}</p>
        <button
          type="button"
          className="secondary-button print-action pdf-link-button"
          onClick={signIn}
        >
          <Link2 size={20} aria-hidden="true" />
          {t('pdfLink.connect')}
        </button>
      </section>
    )
  }

  return (
    <section className="pdf-link">
      <button
        type="button"
        className="secondary-button print-action pdf-link-button"
        disabled={phase === 'creating'}
        onClick={() => void share()}
      >
        <Link2 size={20} aria-hidden="true" />
        {phase === 'creating' ? t('pdfLink.creating') : t('pdfLink.share')}
      </button>
      {link && (
        <div className="pdf-link-result print-row">
          <label className="pdf-link-field">
            <span>{t('pdfLink.ready')}</span>
            <input
              ref={field}
              type="url"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          {tapAgain && (
            <p className="pdf-link-hint pdf-link-wide" role="status">
              {t('pdfLink.tapAgain')}
            </p>
          )}
          <button
            type="button"
            className="secondary-button pdf-link-button"
            onClick={() => void copy()}
          >
            <Copy size={20} aria-hidden="true" />
            {t('pdfLink.copy')}
          </button>
          {copied && (
            <p className="pdf-link-hint pdf-link-wide" role="status">
              {t('pdfLink.copied')}
            </p>
          )}
          <p className="pdf-link-hint pdf-link-wide">{t('pdfLink.note')}</p>
        </div>
      )}
      {phase === 'failed' && (
        <p className="print-warning print-warning--error print-row" role="alert">
          {t('pdfLink.failed')}
        </p>
      )}
    </section>
  )
}
