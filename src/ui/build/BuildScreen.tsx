import { useEffect, useState } from 'react'
import { useEditor } from '../../state/editor'
import { ActionBar } from '../edit/ActionBar'
import { ZoomSlider } from '../edit/ZoomSlider'
import { t } from '../i18n'
import { CollectionsScreen } from '../library/CollectionsScreen'
import { MoreMenu } from '../library/MoreMenu'
import { SizesScreen } from '../library/SizesScreen'
import { Carousel } from './Carousel'
import { Dots } from './Dots'
import { Header } from './Header'
import { PhotoTray } from './PhotoTray'
import { SizeSheet } from './SizeSheet'

const NOTICE_MS = 6000

export function BuildScreen({ onDownload }: { onDownload: () => void }) {
  const hasFrames = useEditor((s) => s.collection.frames.length > 0)
  const addPhotos = useEditor((s) => s.addPhotos)
  const tapPhoto = useEditor((s) => s.tapPhoto)
  const activeFrameId = useEditor((s) => s.activeFrameId)
  const editing = useEditor((s) => s.mode === 'edit')
  const replacing = useEditor((s) => s.replacing)
  const selectedId = useEditor((s) => s.selectedLayerId)
  const selectLayer = useEditor((s) => s.selectLayer)
  const [sheet, setSheet] = useState<'change' | 'new' | 'more' | 'collections' | 'sizes' | null>(
    null,
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const upload = async (files: File[]): Promise<string[]> => {
    setImporting(true)
    try {
      const { failed, photoIds } = await addPhotos(files)
      if (failed.length === 1) setNotice(t('notice.failedOne'))
      else if (failed.length > 1) setNotice(t('notice.failedMany', { count: failed.length }))
      return photoIds
    } catch (e) {
      console.error(e)
      setNotice(t('notice.importFailed'))
      return []
    } finally {
      setImporting(false)
    }
  }

  const addOnTop = async (files: File[]) => {
    // If the user moves to another frame while it is read, the photo just stays in the tray.
    const targetFrameId = activeFrameId ?? undefined
    const [photoId] = await upload(files)
    if (photoId) tapPhoto(photoId, targetFrameId)
  }

  const status = importing ? t('notice.importing') : notice

  return (
    <>
      <Header
        onSizeClick={() => setSheet('change')}
        onMore={() => setSheet('more')}
        onDownload={onDownload}
      />
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
        {editing && !replacing && <ZoomSlider />}
        <div className="tray-float">
          {status && (
            <p className="notice" role="status">
              {status}
            </p>
          )}
          {replacing && selectedId && (
            <p className="notice notice--action">
              {t('replace.hint')}
              {/* Selecting the same layer again leaves replace mode and keeps the edit going. */}
              <button type="button" onClick={() => selectLayer(selectedId)}>
                {t('replace.cancel')}
              </button>
            </p>
          )}
        </div>
        {editing && !replacing ? (
          <ActionBar
            busy={importing}
            onSize={() => setSheet('change')}
            onAdd={(files) => void addOnTop(files)}
          />
        ) : (
          <PhotoTray
            onUpload={(files) => void upload(files)}
            onPhotoTap={(id) => (hasFrames ? tapPhoto(id) : setSheet('new'))}
          />
        )}
      </div>
      {(sheet === 'change' || sheet === 'new') && (
        <SizeSheet
          mode={sheet}
          onClose={() => setSheet(null)}
          onSizeNotSaved={() => setNotice(t('notice.sizeNotSaved'))}
        />
      )}
      {sheet === 'more' && (
        <MoreMenu
          onClose={() => setSheet(null)}
          onCollections={() => setSheet('collections')}
          onSizes={() => setSheet('sizes')}
        />
      )}
      {sheet === 'collections' && <CollectionsScreen onClose={() => setSheet(null)} />}
      {sheet === 'sizes' && <SizesScreen onClose={() => setSheet(null)} />}
    </>
  )
}
