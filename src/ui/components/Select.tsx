import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** The id of the element that names the field. */
  labelledBy: string
  /** Lets a `<label htmlFor>` point at the field. */
  id?: string
}

const LIST_MAX_HEIGHT = 248
const GAP = 6

/** The nearest box that scrolls, or null for the page itself. */
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === 'auto' || overflowY === 'scroll') return el
  }
  return null
}

/**
 * A field to pick one of a few options, drawn like the rest of the app instead of the
 * browser's own list. Focus stays on the field; arrows, Enter, Escape and Tab work as in
 * a native one.
 */
export function Select({ value, options, onChange, labelledBy, id }: SelectProps) {
  const listId = useId()
  const optionId = (index: number) => `${listId}-${index}`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [upward, setUpward] = useState(false)
  const [active, setActive] = useState(0)
  // Set by an Escape that closed the list, so the sheet around it does not close too.
  const swallowCancel = useRef(false)

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const selected = options[selectedIndex]

  const show = () => {
    const trigger = triggerRef.current
    if (trigger) {
      const box = trigger.getBoundingClientRect()
      const parent = scrollParent(trigger)
      const bounds = parent
        ? parent.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight }
      const needed = Math.min(LIST_MAX_HEIGHT, options.length * 48 + 12) + GAP
      const below = Math.min(bounds.bottom, window.innerHeight) - box.bottom
      const above = box.top - Math.max(bounds.top, 0)
      setUpward(below < needed && above > below)
    }
    setActive(selectedIndex)
    setOpen(true)
    // Safari does not focus a button on a click; the keys go to the focused element.
    trigger?.focus()
  }

  const hide = () => setOpen(false)

  /** Closes the list on Escape and keeps the sheet around it open. */
  const escape = () => {
    // Only for this key press: the next one clears it before anything else sees it.
    swallowCancel.current = true
    setOpen(false)
  }

  const choose = (index: number) => {
    const option = options[index]
    hide()
    if (option && option.value !== value) onChange(option.value)
  }

  // WebKit closes a modal dialog on Escape even when the key is handled: its cancel event is
  // stopped on the way down, before the dialog sees it.
  useEffect(() => {
    const onCancel = (e: Event) => {
      if (!swallowCancel.current) return
      swallowCancel.current = false
      e.preventDefault()
      e.stopPropagation()
    }
    const onKeyDown = () => {
      swallowCancel.current = false
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('cancel', onCancel, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('cancel', onCancel, true)
    }
  }, [])

  // A press anywhere else closes the list.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    // Escape closes the list wherever the focus is.
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target === triggerRef.current) return
      e.preventDefault()
      escape()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  // Keeps the highlighted option in view while the arrows move it.
  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active])

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => Math.min(last, i + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => Math.max(0, i - 1))
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(last)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(active)
        break
      case 'Escape':
        // Closes the list only, not the sheet around it.
        e.preventDefault()
        e.stopPropagation()
        escape()
        break
      case 'Tab':
        hide()
        break
    }
  }

  return (
    <div className="select" ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelledBy}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{selected?.label}</span>
        <ChevronDown className="select-chevron" size={18} strokeWidth={2.5} aria-hidden="true" />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={labelledBy}
          className={upward ? 'select-list select-list--up' : 'select-list'}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={index === selectedIndex}
              className="select-option"
              data-active={index === active || undefined}
              // Keeps the focus on the field.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {option.label}
              {index === selectedIndex && <Check size={18} strokeWidth={2.5} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
