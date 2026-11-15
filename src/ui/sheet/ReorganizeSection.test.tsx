import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReorganizeSection } from './ReorganizeSection'

const button = () => screen.getByRole('button', { name: /Reorganiz/ })

describe('ReorganizeSection', () => {
  it('offers to reorganize and calls back on a tap', () => {
    const onReorganize = vi.fn()
    render(
      <ReorganizeSection
        disabled={false}
        reorganizing={false}
        reorganized={null}
        onReorganize={onReorganize}
      />,
    )
    expect(button()).toHaveTextContent('Reorganizar encaixe')
    expect(button()).toBeEnabled()
    fireEvent.click(button())
    expect(onReorganize).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('is off while it runs', () => {
    render(
      <ReorganizeSection disabled={false} reorganizing reorganized={null} onReorganize={vi.fn()} />,
    )
    expect(button()).toHaveTextContent('Reorganizando…')
    expect(button()).toBeDisabled()
  })

  it('is off when told so', () => {
    render(
      <ReorganizeSection disabled reorganizing={false} reorganized={null} onReorganize={vi.fn()} />,
    )
    expect(button()).toBeDisabled()
  })

  it('says how many sheets remain after a reduction', () => {
    const { rerender } = render(
      <ReorganizeSection
        disabled={false}
        reorganizing={false}
        reorganized={{ reduced: true, sheets: 3 }}
        onReorganize={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Agora em 3 folhas')
    rerender(
      <ReorganizeSection
        disabled={false}
        reorganizing={false}
        reorganized={{ reduced: true, sheets: 1 }}
        onReorganize={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Agora em 1 folha')
  })

  it('says when nothing better was found', () => {
    render(
      <ReorganizeSection
        disabled={false}
        reorganizing={false}
        reorganized={{ reduced: false, sheets: 2 }}
        onReorganize={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Este já é o melhor encaixe que encontrei.',
    )
  })
})
