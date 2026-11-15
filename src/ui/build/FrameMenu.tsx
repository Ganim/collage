import { ArrowLeftRight, CopyPlus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useEditor } from '../../state/editor'
import { BottomSheet } from '../components/BottomSheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { t } from '../i18n'
import { useLongPress } from '../useLongPress'

/**
 * Press and hold (or right-click) the frame on screen to flip, duplicate or remove it.
 * Returns the handlers for the frame's wrapper and the sheets to render beside it.
 */
export function useFrameMenu(enabled: boolean) {
  const duplicateActive = useEditor((s) => s.duplicateActive)
  const removeActive = useEditor((s) => s.removeActive)
  const flipActive = useEditor((s) => s.flipActive)
  const [sheet, setSheet] = useState<'menu' | 'remove' | null>(null)
  const press = useLongPress(() => setSheet('menu'))
  const handlers = enabled ? press : {}

  const close = () => setSheet(null)

  const sheets = (
    <>
      {sheet === 'menu' && (
        <BottomSheet title={t('frameMenu.title')} onClose={close}>
          <ul className="menu-list">
            <li>
              <button
                type="button"
                className="menu-row"
                onClick={() => {
                  close()
                  flipActive()
                }}
              >
                <ArrowLeftRight size={22} />
                {t('sizeSheet.flip')}
              </button>
            </li>
            <li>
              <button
                type="button"
                className="menu-row"
                onClick={() => {
                  close()
                  duplicateActive()
                }}
              >
                <CopyPlus size={22} />
                {t('header.frameDuplicate')}
              </button>
            </li>
            <li>
              <button
                type="button"
                className="menu-row menu-row--danger"
                onClick={() => setSheet('remove')}
              >
                <Trash2 size={22} />
                {t('header.frameRemove')}
              </button>
            </li>
          </ul>
        </BottomSheet>
      )}
      {sheet === 'remove' && (
        <ConfirmSheet
          title={t('header.frameRemoveTitle')}
          body={t('header.frameRemoveBody')}
          confirmLabel={t('header.frameRemoveConfirm')}
          danger
          onConfirm={removeActive}
          onClose={close}
        />
      )}
    </>
  )

  return { handlers, sheets }
}
