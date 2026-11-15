import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Select } from './Select'

const OPTIONS = [
  { value: 'a4', label: 'A4' },
  { value: 'a3', label: 'A3' },
  { value: 'custom', label: 'Personalizado' },
]

function Field({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('a4')
  return (
    <>
      <span id="paper">Papel</span>
      <Select
        labelledBy="paper"
        value={value}
        options={OPTIONS}
        onChange={(v) => {
          setValue(v)
          onChange?.(v)
        }}
      />
    </>
  )
}

describe('Select', () => {
  it('shows the chosen option and opens its list on a tap', () => {
    render(<Field />)
    const field = screen.getByRole('combobox', { name: 'Papel' })
    expect(field).toHaveTextContent('A4')
    expect(field).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(field)
    expect(field).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('option', { name: 'A4' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('option', { name: 'A3' }))
    expect(field).toHaveTextContent('A3')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('works from the keyboard', () => {
    const onChange = vi.fn()
    render(<Field onChange={onChange} />)
    const field = screen.getByRole('combobox', { name: 'Papel' })

    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeVisible()
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('custom')
    expect(field).toHaveTextContent('Personalizado')
  })

  it('closes on Escape without choosing, and stops the key there', () => {
    const onChange = vi.fn()
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <Field onChange={onChange} />
      </div>,
    )
    const field = screen.getByRole('combobox', { name: 'Papel' })
    fireEvent.click(field)
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(outer.mock.calls.map(([e]) => (e as KeyboardEvent).key)).not.toContain('Escape')
  })

  it('closes on a press outside', () => {
    render(<Field />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Papel' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
