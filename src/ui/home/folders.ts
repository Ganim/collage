import { FRAME_PRESETS, type SizePreset } from '../../core/presets'
import type { SavedSize, SizeFolder } from '../../core/types'
import { t } from '../i18n'

/** The folder of the ready-made sizes: read-only. */
export const DEFAULTS_ID = 'padrao'
/** Where a size without a folder lives: always there, never renamed or deleted. */
export const MINE_ID = 'meus'

export interface SizeGroup {
  id: string
  name: string
  /** The two folders the app keeps: no renaming, no deleting. */
  fixed: boolean
  sizes: (SavedSize | SizePreset)[]
}

export const isPreset = (s: SavedSize | SizePreset): s is SizePreset => !('name' in s)

/** Tamanhos padrão, Meus tamanhos, then the user's folders oldest first. */
export function groupSizes(folders: SizeFolder[], sizes: SavedSize[]): SizeGroup[] {
  const known = new Set(folders.map((f) => f.id))
  const inFolder = (id: string) => sizes.filter((s) => s.folderId === id)
  return [
    { id: DEFAULTS_ID, name: t('folders.defaults'), fixed: true, sizes: FRAME_PRESETS },
    {
      id: MINE_ID,
      name: t('folders.mine'),
      fixed: true,
      sizes: sizes.filter((s) => !s.folderId || !known.has(s.folderId)),
    },
    ...[...folders]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((f) => ({ id: f.id, name: f.name, fixed: false, sizes: inFolder(f.id) })),
  ]
}
