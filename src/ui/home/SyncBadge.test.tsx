import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSyncStatus } from '../../sync/status'
import { useSyncSentence } from './SyncBadge'

beforeEach(() => {
  useSyncStatus.setState({
    state: 'idle',
    error: undefined,
    lastSyncedAt: undefined,
    photos: undefined,
    changeCount: 0,
    changedIds: [],
  })
})

describe('useSyncSentence', () => {
  it('renders again only when a field of the sentence changes', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useSyncSentence()
    })
    expect(result.current).toBe('Ainda não sincronizado')
    const before = renders

    act(() => {
      useSyncStatus.setState((s) => ({ changeCount: s.changeCount + 1, changedIds: ['c1'] }))
    })
    act(() => useSyncStatus.setState({ state: 'idle', error: undefined }))
    expect(renders).toBe(before)

    act(() => useSyncStatus.setState({ state: 'syncing' }))
    expect(result.current).toBe('Sincronizando…')
    act(() => useSyncStatus.setState({ photos: { done: 1, total: 3 } }))
    expect(result.current).toBe('Baixando fotos (1 de 3)')
    act(() => useSyncStatus.setState({ state: 'error', error: 'full', photos: undefined }))
    expect(result.current).toBe('O Google Drive está cheio. Libere espaço para sincronizar.')
    expect(renders).toBe(before + 3)
  })
})
