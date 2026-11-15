import { describe, expect, it } from 'vitest'
import type { SyncStatus } from '../../sync/status'
import { relativeTime, syncIcon, syncSentence } from './syncText'

const NOW = new Date(2026, 10, 15, 12, 0).getTime()
const MIN = 60_000
const status = (s: Partial<SyncStatus>): SyncStatus => ({
  state: 'idle',
  changeCount: 0,
  changedIds: [],
  ...s,
})

describe('relativeTime', () => {
  it('says "agora" under a minute, then minutes, then hours, then the date', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('agora')
    expect(relativeTime(NOW + 5_000, NOW)).toBe('agora')
    expect(relativeTime(NOW - 5 * MIN, NOW)).toBe('há 5 min')
    expect(relativeTime(NOW - 59 * MIN, NOW)).toBe('há 59 min')
    expect(relativeTime(NOW - 2 * 60 * MIN, NOW)).toBe('há 2 h')
    expect(relativeTime(NOW - 23 * 60 * MIN, NOW)).toBe('há 23 h')
    expect(relativeTime(new Date(2026, 10, 10, 9).getTime(), NOW)).toBe('em 10/11/2026')
  })
})

describe('syncSentence', () => {
  it('describes every state', () => {
    expect(syncSentence(status({ lastSyncedAt: NOW - 5 * MIN }), NOW)).toBe('Sincronizado há 5 min')
    expect(syncSentence(status({}), NOW)).toBe('Ainda não sincronizado')
    expect(syncSentence(status({ state: 'syncing' }), NOW)).toBe('Sincronizando…')
    expect(syncSentence(status({ state: 'syncing', photos: { done: 2, total: 5 } }), NOW)).toBe(
      'Baixando fotos (2 de 5)',
    )
    expect(syncSentence(status({ state: 'offline' }), NOW)).toBe(
      'Sem internet: sincroniza quando voltar',
    )
    expect(syncSentence(status({ state: 'needsDrive' }), NOW)).toBe('Só neste aparelho')
    expect(syncSentence(status({ state: 'off' }), NOW)).toBe('Só neste aparelho')
    expect(syncSentence(status({ state: 'error', error: 'full' }), NOW)).toBe(
      'O Google Drive está cheio. Libere espaço para sincronizar.',
    )
    expect(syncSentence(status({ state: 'error', error: 'revoked' }), NOW)).toBe(
      'O acesso ao Google Drive foi removido.',
    )
    expect(syncSentence(status({ state: 'error', error: 'other' }), NOW)).toBe(
      'Não foi possível sincronizar agora. Tente de novo.',
    )
  })
})

describe('syncIcon', () => {
  it('turns while syncing, is a cloud when synced and a crossed cloud otherwise', () => {
    expect(syncIcon(status({}))).toBe('synced')
    expect(syncIcon(status({ state: 'syncing' }))).toBe('syncing')
    expect(syncIcon(status({ photos: { done: 0, total: 1 } }))).toBe('syncing')
    for (const state of ['offline', 'needsDrive', 'error', 'off'] as const) {
      expect(syncIcon(status({ state }))).toBe('off')
    }
  })
})
