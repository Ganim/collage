import { describe, expect, it } from 'vitest'
import { FRAME_PRESETS } from '../../core/presets'
import type { SavedSize, SizeFolder } from '../../core/types'
import { DEFAULTS_ID, MINE_ID, groupSizes } from './folders'

const folder = (id: string, name: string, createdAt: number): SizeFolder => ({
  id,
  name,
  createdAt,
})

const size = (id: string, folderId?: string): SavedSize => ({
  id,
  name: `Tamanho ${id}`,
  widthMm: 100,
  heightMm: 150,
  ...(folderId ? { folderId } : {}),
})

describe('groupSizes', () => {
  it('puts the defaults first, then Meus tamanhos, then the folders by creation', () => {
    const groups = groupSizes([folder('b', 'Sala', 20), folder('a', 'Quarto', 10)], [])
    expect(groups.map((g) => [g.id, g.name, g.fixed])).toEqual([
      [DEFAULTS_ID, 'Tamanhos padrão', true],
      [MINE_ID, 'Meus tamanhos', true],
      ['a', 'Quarto', false],
      ['b', 'Sala', false],
    ])
  })

  it('places each size in its folder, and one without a folder in Meus tamanhos', () => {
    const groups = groupSizes([folder('a', 'Quarto', 10)], [size('1', 'a'), size('2')])
    expect(groups.find((g) => g.id === 'a')?.sizes.map((s) => s.id)).toEqual(['1'])
    expect(groups.find((g) => g.id === MINE_ID)?.sizes.map((s) => s.id)).toEqual(['2'])
  })

  it('sends a size whose folder is gone to Meus tamanhos', () => {
    const groups = groupSizes([], [size('1', 'gone')])
    expect(groups.find((g) => g.id === MINE_ID)?.sizes.map((s) => s.id)).toEqual(['1'])
  })

  it('keeps the presets only in Tamanhos padrão', () => {
    const groups = groupSizes([folder('a', 'Quarto', 10)], [size('1', 'a')])
    expect(groups[0]?.sizes).toEqual(FRAME_PRESETS)
    for (const group of groups.slice(1)) {
      expect(group.sizes.some((s) => FRAME_PRESETS.includes(s as never))).toBe(false)
    }
  })
})
