import type { SyncStatus } from '../../sync/status'
import { t } from '../i18n'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "agora", "há 5 min", "há 2 h", or the date for anything a day old or more. */
export function relativeTime(at: number, now: number): string {
  const ago = now - at
  if (ago < MINUTE) return t('sync.when.now')
  if (ago < HOUR) return t('sync.when.minutes', { n: Math.floor(ago / MINUTE) })
  if (ago < DAY) return t('sync.when.hours', { n: Math.floor(ago / HOUR) })
  return t('sync.when.date', { date: new Date(at).toLocaleDateString('pt-BR') })
}

/** The status as one sentence: the badge's accessible name and the line in the account menu. */
export function syncSentence(s: SyncStatus, now: number): string {
  if (s.photos) return t('sync.photos', { done: s.photos.done, total: s.photos.total })
  switch (s.state) {
    case 'syncing':
      return t('sync.syncing')
    case 'offline':
      return t('sync.offline')
    case 'error':
      return t(
        s.error === 'full' ? 'sync.full' : s.error === 'revoked' ? 'sync.revoked' : 'sync.failed',
      )
    case 'idle':
      return s.lastSyncedAt === undefined
        ? t('sync.never')
        : t('sync.synced', { when: relativeTime(s.lastSyncedAt, now) })
    default:
      return t('sync.localOnly')
  }
}

export function syncIcon(s: SyncStatus): 'synced' | 'syncing' | 'off' {
  if (s.state === 'syncing' || s.photos) return 'syncing'
  return s.state === 'idle' ? 'synced' : 'off'
}

/** Sync cannot work until the person signs in again granting the Drive. */
export const needsConnect = (s: SyncStatus) =>
  s.state === 'needsDrive' || (s.state === 'error' && s.error === 'revoked')
