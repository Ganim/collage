import { CopyPlus, Trash2 } from 'lucide-react'
import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useEditor } from '../../state/editor'
import { BottomSheet } from '../components/BottomSheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { t } from '../i18n'

const HOLD_MS = 500
/** A finger that moves further than this is swiping, not holding. */
const SLOP_PX = 10

/**
 * Press and hold (or right-click) the frame on screen to duplicate or remove it.
 * Returns the handlers for the frame's wrapper and the sheets to render beside it.
 */
export function useFrameMenu(enabled: boolean) {
  const duplicateActive = useEditor((s) => s.duplicateActive)
  const removeActive = useEditor((s) => s.removeActive)
  const [sheet, setSheet] = useState<'menu' | 'remove' | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  // The click that ends a hold must not also count as a tap on the frame.
  const held = useRef(false)

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }

  const open = () => {
    cancel()
    held.current = true
    setSheet('menu')
  }

  const handlers = enabled
    ? {
        onPointerDown: (e: ReactPointerEvent) => {
          held.current = false
          if (e.pointerType === 'mouse') return
          start.current = { x: e.clientX, y: e.clientY }
          timer.current = setTimeout(open, HOLD_MS)
        },
        onPointerMove: (e: ReactPointerEvent) => {
          const from = start.current
          if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP_PX) cancel()
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        onContextMenu: (e: ReactMouseEvent) => {
          e.preventDefault()
          open()
        },
        onClickCapture: (e: ReactMouseEvent) => {
          if (held.current) {
            held.current = false
            e.stopPropagation()
          }
        },
      }
    : {}

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
