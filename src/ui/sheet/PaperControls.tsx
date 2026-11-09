import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { PAPER_PRESETS } from '../../core/presets'
import type { Paper } from '../../core/types'
import { useEditor } from '../../state/editor'
import { parseCm, parseMm } from '../build/sizeText'
import { t } from '../i18n'

const CUSTOM = 'custom'

interface Draft {
  choice: string
  width: string
  height: string
  margin: string
  gap: string
}

const decimal = (value: number) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 1, useGrouping: false })

function initialDraft(paper: Paper): Draft {
  const preset = PAPER_PRESETS.find(
    (p) => p.widthMm === paper.widthMm && p.heightMm === paper.heightMm,
  )
  return {
    choice: preset?.id ?? CUSTOM,
    width: decimal(paper.widthMm / 10),
    height: decimal(paper.heightMm / 10),
    margin: decimal(paper.marginMm),
    gap: decimal(paper.gapMm),
  }
}

function readDraft(draft: Draft) {
  const preset = PAPER_PRESETS.find((p) => p.id === draft.choice)
  return {
    widthMm: preset ? preset.widthMm : parseCm(draft.width),
    heightMm: preset ? preset.heightMm : parseCm(draft.height),
    marginMm: parseMm(draft.margin),
    gapMm: parseMm(draft.gap),
  }
}

interface PaperControlsProps {
  paper: Paper
  /** False while a field holds something unusable, so the paper is not what the fields say. */
  onValidityChange: (valid: boolean) => void
}

export function PaperControls({ paper, onValidityChange }: PaperControlsProps) {
  const setPaper = useEditor((s) => s.setPaper)
  const [draft, setDraft] = useState(() => initialDraft(paper))
  const values = readDraft(draft)
  const custom = draft.choice === CUSTOM

  const update = (next: Draft) => {
    setDraft(next)
    const read = readDraft(next)
    const usable = Object.entries(read).filter(([, value]) => value !== null)
    setPaper(Object.fromEntries(usable) as Partial<Paper>)
    onValidityChange(usable.length === Object.keys(read).length)
  }

  const choose = (choice: string) =>
    update(
      choice === CUSTOM
        ? {
            ...draft,
            choice,
            width: decimal(paper.widthMm / 10),
            height: decimal(paper.heightMm / 10),
          }
        : { ...draft, choice },
    )

  const cmInvalid = custom && (values.widthMm === null || values.heightMm === null)
  const mmInvalid = values.marginMm === null || values.gapMm === null

  return (
    <div className="print-controls">
      <label className="print-field print-field--wide">
        {t('print.paper')}
        <span className="print-select">
          <select value={draft.choice} onChange={(e) => choose(e.target.value)}>
            {PAPER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.id === 'letter' ? t('print.letter') : preset.label}
              </option>
            ))}
            <option value={CUSTOM}>{t('print.custom')}</option>
          </select>
          <ChevronDown size={18} />
        </span>
      </label>
      {custom && (
        <>
          <label className="print-field">
            {t('sizeSheet.width')}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={values.widthMm === null}
              value={draft.width}
              onChange={(e) => update({ ...draft, width: e.target.value })}
            />
          </label>
          <label className="print-field">
            {t('sizeSheet.height')}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={values.heightMm === null}
              value={draft.height}
              onChange={(e) => update({ ...draft, height: e.target.value })}
            />
          </label>
        </>
      )}
      <label className="print-field">
        {t('print.margin')}
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={values.marginMm === null}
          value={draft.margin}
          onChange={(e) => update({ ...draft, margin: e.target.value })}
        />
      </label>
      <label className="print-field">
        {t('print.gap')}
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={values.gapMm === null}
          value={draft.gap}
          onChange={(e) => update({ ...draft, gap: e.target.value })}
        />
      </label>
      {(cmInvalid || mmInvalid) && (
        <p className="print-invalid print-field--wide" role="status">
          {cmInvalid ? t('sizeSheet.invalid') : t('print.invalidMm')}
        </p>
      )}
    </div>
  )
}
