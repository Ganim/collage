import { ArrowLeft } from 'lucide-react'
import { useRef, useState } from 'react'
import { useEditor } from '../../state/editor'
import { generatePdf, MissingPhotoError } from '../../render/generate'
import { t } from '../i18n'
import { useMissingPhotos } from '../useMissingPhotos'
import { deliverPdf, pdfFileName } from './deliver'
import { PaperControls } from './PaperControls'
import { SheetPreview } from './SheetPreview'
import { useSheetLayout } from './useSheetLayout'
import { Warnings } from './Warnings'

export function SheetScreen({ onBack }: { onBack: () => void }) {
  const collection = useEditor((s) => s.collection)
  const photos = useEditor((s) => s.photos)
  const { frames, paper } = collection
  const { layout, paper: layoutPaper, current, failed } = useSheetLayout(frames, paper)
  const { missing, recheck } = useMissingPhotos(frames)
  const [inputsValid, setInputsValid] = useState(true)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [generated, setGenerated] = useState<{ key: string; pdf: Blob } | null>(null)
  const [error, setError] = useState<{ key: string; text: string } | null>(null)
  const generating = useRef(false)
  const saving = useRef(false)

  // A PDF only stands for the exact frames, photos and paper it was built from.
  const contentKey = JSON.stringify({ frames, paper })
  const placed = layout ? layout.sheets.flat().length : 0
  const unplacedIds = layout ? layout.unplaced : []
  const missingFrameIds = missing
    ? frames.filter((f) => f.layers.some((l) => missing.has(l.photoId))).map((f) => f.id)
    : []
  const ready = generated?.key === contentKey && inputsValid
  const canGenerate =
    current &&
    inputsValid &&
    placed > 0 &&
    unplacedIds.length === 0 &&
    missing !== null &&
    missing.size === 0

  const generate = async () => {
    if (generating.current || !canGenerate || !layout) return
    generating.current = true
    const key = contentKey
    setError(null)
    setProgress({ done: 0, total: placed })
    try {
      const pdf = await generatePdf({ collection, layout }, (done, total) =>
        setProgress({ done, total }),
      )
      setGenerated({ key, pdf })
    } catch (e) {
      console.error(e)
      if (e instanceof MissingPhotoError) recheck()
      setError({
        key,
        text:
          e instanceof MissingPhotoError ? t('print.generateMissing') : t('print.generateFailed'),
      })
    } finally {
      generating.current = false
      setProgress(null)
    }
  }

  const save = async () => {
    if (saving.current || !ready) return
    saving.current = true
    setError(null)
    try {
      await deliverPdf(generated.pdf, pdfFileName(collection.name))
    } catch (e) {
      console.error(e)
      setError({ key: contentKey, text: t('print.saveFailed') })
    } finally {
      saving.current = false
    }
  }

  const summary = layout
    ? layout.sheets.length === 1
      ? t('print.summaryOne', { percent: Math.round(layout.usedRatio * 100) })
      : t('print.summaryMany', {
          count: layout.sheets.length,
          percent: Math.round(layout.usedRatio * 100),
        })
    : ''

  let action = (
    <button
      type="button"
      className="primary-button print-action"
      disabled={!canGenerate}
      onClick={() => void generate()}
    >
      {t('print.generate')}
    </button>
  )
  if (progress) {
    action = (
      <button type="button" className="primary-button print-action" disabled>
        {t('print.progress', { done: progress.done, total: progress.total })}
      </button>
    )
  } else if (ready) {
    action = (
      <button type="button" className="primary-button print-action" onClick={() => void save()}>
        {t('print.save')}
      </button>
    )
  }

  return (
    <div className="print-screen">
      <header className="print-header">
        <button type="button" className="icon-button" aria-label={t('print.back')} onClick={onBack}>
          <ArrowLeft size={22} />
        </button>
        <span className="print-summary">{summary}</span>
      </header>
      <div className="print-scroll">
        <PaperControls paper={paper} onValidityChange={setInputsValid} />
        {layout && layoutPaper && (
          <SheetPreview layout={layout} paper={layoutPaper} frames={frames} stale={!current} />
        )}
      </div>
      <div className="print-footer">
        <Warnings
          frames={frames}
          photos={photos}
          unplacedIds={unplacedIds}
          missingFrameIds={missingFrameIds}
          nothingToPrint={current && placed === 0 && unplacedIds.length === 0}
        />
        {failed && (
          <p className="print-warning print-warning--error" role="alert">
            {t('print.layoutFailed')}
          </p>
        )}
        {error?.key === contentKey && (
          <p className="print-warning print-warning--error" role="alert">
            {error.text}
          </p>
        )}
        <p className="print-real-size">{t('print.realSize')}</p>
        {action}
      </div>
    </div>
  )
}
