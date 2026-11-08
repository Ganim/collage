import { Plus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useEditor } from '../../state/editor'
import { t } from '../i18n'

export function Dots({ onAdd }: { onAdd: () => void }) {
  const frames = useEditor((s) => s.collection.frames)
  const activeId = useEditor((s) => s.activeFrameId)
  const setActive = useEditor((s) => s.setActive)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeId])

  return (
    <nav aria-label={t('dots.label')}>
      <ol className="dots">
        {frames.map((frame, i) => {
          const active = frame.id === activeId
          return (
            <li key={frame.id}>
              <button
                type="button"
                ref={active ? activeRef : undefined}
                className="dot"
                aria-label={t('dots.goTo', { position: i + 1 })}
                aria-current={active ? 'true' : undefined}
                onClick={() => setActive(frame.id)}
              />
            </li>
          )
        })}
        <li className="dots-add">
          <button type="button" className="icon-button" aria-label={t('dots.add')} onClick={onAdd}>
            <Plus size={22} />
          </button>
        </li>
      </ol>
    </nav>
  )
}
