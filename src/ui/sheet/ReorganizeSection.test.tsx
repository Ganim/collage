import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReorganizeSection } from './ReorganizeSection'

const button = () => screen.getByRole('button', { name: /Reorganiz/ })

describe('ReorganizeSection', () => {
  it('offers to reorganize and calls back on a tap', () => {
    const onReorganize = vi.fn()
    render(
      <ReorganizeSection
        offer
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
      <ReorganizeSection
        offer
        disabled={false}
        reorganizing
        reorganized={null}
        onReorganize={vi.fn()}
      />,
    )
    expect(button()).toHaveTextContent('Reorganizando…')
    expect(button()).toBeDisabled()
  })

  it('is off when told so', () => {
    render(
      <ReorganizeSection
        offer
        disabled
        reorganizing={false}
        reorganized={null}
        onReorganize={vi.fn()}
      />,
    )
    expect(button()).toBeDisabled()
  })

  it('says how many sheets remain after a reduction', () => {
    const { rerender } = render(
      <ReorganizeSection
        offer
        disabled={false}
        reorganizing={false}
        reorganized={{ reduced: true, sheets: 3 }}
        onReorganize={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Agora em 3 folhas')
    rerender(
      <ReorganizeSection
        offer
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
        offer
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

  it('leaves the button out when no fewer sheets are possible, keeping the outcome', () => {
    render(
      <ReorganizeSection
        offer={false}
        disabled={false}
        reorganizing={false}
        reorganized={{ reduced: true, sheets: 1 }}
        onReorganize={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Agora em 1 folha')
  })
})
