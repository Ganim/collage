import { useEffect, useState } from 'react'
import { useEditor } from '../../state/editor'
import { t } from '../i18n'
import { Carousel } from './Carousel'
import { Dots } from './Dots'
import { Header } from './Header'
import { PhotoTray } from './PhotoTray'
import { SizeSheet } from './SizeSheet'

const NOTICE_MS = 6000

export function BuildScreen() {
  const hasFrames = useEditor((s) => s.collection.frames.length > 0)
  const saveStatus = useEditor((s) => s.saveStatus)
  const addPhotos = useEditor((s) => s.addPhotos)
  const tapPhoto = useEditor((s) => s.tapPhoto)
  const [sheet, setSheet] = useState<'change' | 'new' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  // A retry passes through 'saving'; the warning stays up until a save really works.
  const [saveFailed, setSaveFailed] = useState(false)
  if (saveStatus === 'full' && !saveFailed) setSaveFailed(true)
  if (saveStatus === 'saved' && saveFailed) setSaveFailed(false)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const upload = async (files: File[]) => {
    setImporting(true)
    try {
      const { failed } = await addPhotos(files)
      if (failed.length === 1) setNotice(t('notice.failedOne'))
      else if (failed.length > 1) setNotice(t('notice.failedMany', { count: failed.length }))
    } catch (e) {
      console.error(e)
      setNotice(t('notice.importFailed'))
    } finally {
      setImporting(false)
    }
  }

  const status = importing ? t('notice.importing') : notice

  return (
    <>
      {saveFailed && (
        <p className="banner" role="alert">
          {t('banner.saveFailed')}
        </p>
      )}
      <Header onSizeClick={() => setSheet('change')} />
      <div className="stage">
        {hasFrames ? (
          <Carousel />
        ) : (
          <div className="empty-stage">
            <h1>{t('empty.title')}</h1>
            <p>{t('empty.body')}</p>
            <button type="button" className="primary-button" onClick={() => setSheet('new')}>
              {t('empty.action')}
            </button>
          </div>
        )}
      </div>
      <Dots onAdd={() => setSheet('new')} />
      <div className="tray-area">
        {status && (
          <p className="notice" role="status">
            {status}
          </p>
        )}
        <PhotoTray
          onUpload={(files) => void upload(files)}
          onPhotoTap={(id) => (hasFrames ? tapPhoto(id) : setSheet('new'))}
        />
      </div>
      {sheet && (
        <SizeSheet
          mode={sheet}
          onClose={() => setSheet(null)}
          onSizeNotSaved={() => setNotice(t('notice.sizeNotSaved'))}
        />
      )}
    </>
  )
}
