import { useEffect, useLayoutEffect, useRef } from 'react'
import { useEditor } from '../../state/editor'
import { EditLayer } from '../edit/EditLayer'
import { t } from '../i18n'
import { FrameView } from './FrameView'

export function Carousel() {
  const frames = useEditor((s) => s.collection.frames)
  const activeId = useEditor((s) => s.activeFrameId)
  const setActive = useEditor((s) => s.setActive)
  const editing = useEditor((s) => s.mode === 'edit')
  const selectedId = useEditor((s) => s.selectedLayerId)
  const enterEdit = useEditor((s) => s.enterEdit)
  const exitEdit = useEditor((s) => s.exitEdit)
  const scrollerRef = useRef<HTMLElement>(null)
  // A drag that begins on the frame and ends past it is not a tap outside.
  const pressedOutside = useRef(false)
  // The frame the scroll position already shows, so a swipe is not answered with a scroll.
  const shownId = useRef<string | null>(null)
  const frameIds = frames.map((f) => f.id).join()
  const activeIndex = frames.findIndex((f) => f.id === activeId)

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || activeId === shownId.current) return
    shownId.current = activeId
    const slide = scroller.querySelector<HTMLElement>(`[data-frame-id="${activeId}"]`)
    if (slide) {
      scroller.scrollTo({ left: slide.offsetLeft - (scroller.clientWidth - slide.offsetWidth) / 2 })
    }
  }, [activeId])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const observer = new IntersectionObserver(
      (entries) => {
        const centered = entries.filter((e) => e.isIntersecting).at(-1)
        const id = (centered?.target as HTMLElement | undefined)?.dataset.frameId
        if (id && id !== shownId.current) {
          shownId.current = id
          setActive(id)
        }
      },
      // Narrowed to a strip down the middle, so only the centred slide counts.
      { root: scroller, rootMargin: '0px -49% 0px -49%' },
    )
    scroller.querySelectorAll('[data-frame-id]').forEach((slide) => observer.observe(slide))
    return () => observer.disconnect()
  }, [frameIds, setActive])

  return (
    <section
      ref={scrollerRef}
      className={editing ? 'carousel carousel--locked' : 'carousel'}
      aria-label={t('carousel.label')}
      onPointerDown={(e) => {
        pressedOutside.current = !(e.target as Element).closest('[data-edit-surface]')
      }}
      onClick={() => {
        if (editing && pressedOutside.current) exitEdit()
      }}
    >
      {frames.map((frame, i) => {
        const active = frame.id === activeId
        const selected =
          active && editing ? frame.layers.find((l) => l.id === selectedId) : undefined
        return (
          <div
            key={frame.id}
            data-frame-id={frame.id}
            className={active ? 'slide slide--active' : 'slide'}
          >
            <FrameView
              frame={frame}
              interactive={active && !editing && frame.layers.length > 0}
              onTap={() => enterEdit()}
              label={t('frame.label', { position: i + 1, total: frames.length })}
              showImages={Math.abs(i - activeIndex) <= 1}
            />
            {selected && <EditLayer frame={frame} selected={selected} />}
          </div>
        )
      })}
    </section>
  )
}
