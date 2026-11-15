import { CloudUpload, Heart, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useSyncStatus } from '../../sync/status'
import { syncNow } from '../../sync/useSync'
import { signIn, type Account } from '../account/account'
import { BottomSheet } from '../components/BottomSheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { refreshApp } from '../account/refreshApp'
import { t } from '../i18n'
import { SyncBadge, useSyncSentence } from './SyncBadge'
import { needsConnect } from './syncText'

/** The account's photo, or its first letter on a fuchsia disc when there is none (or it fails). */
function Avatar({ account, size }: { account: Account; size: 'small' | 'large' }) {
  const [broken, setBroken] = useState(false)
  const initial = (account.name || account.email).trim().charAt(0).toUpperCase()
  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {account.picture && !broken ? (
        <img
          src={account.picture}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        initial
      )}
    </span>
  )
}

interface AccountHeaderProps {
  account: Account
  onSignOut: () => void
}

export function AccountHeader({ account, onSignOut }: AccountHeaderProps) {
  const [sheet, setSheet] = useState<'account' | 'signOut' | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const connect = useSyncStatus(needsConnect)
  const syncing = useSyncStatus((s) => s.state === 'syncing')
  const sentence = useSyncSentence()

  return (
    <header className="account-header">
      <h1 className="brand">
        {t('app.name')}
        <Heart size={16} aria-hidden="true" />
      </h1>
      <div className="account-actions">
        <SyncBadge onOpen={() => setSheet('account')} />
        <button
          type="button"
          className="avatar-button"
          aria-label={t('account.open')}
          onClick={() => setSheet('account')}
        >
          <Avatar account={account} size="small" />
        </button>
      </div>

      {sheet === 'account' && (
        <BottomSheet title={t('account.title')} onClose={() => setSheet(null)}>
          <div className="account-card">
            <Avatar account={account} size="large" />
            <div className="account-who">
              {account.name && <p className="account-name">{account.name}</p>}
              <p className="account-email">{account.email}</p>
            </div>
          </div>
          <ul className="menu-list">
            <li>
              {connect ? (
                <button type="button" className="menu-row" onClick={signIn}>
                  <CloudUpload size={22} />
                  {t('sync.connect')}
                </button>
              ) : (
                <button
                  type="button"
                  className="menu-row"
                  aria-describedby="sync-status-line"
                  disabled={syncing}
                  onClick={() => void syncNow()}
                >
                  <RefreshCw size={22} className={syncing ? 'spinning' : undefined} />
                  {t('sync.now')}
                </button>
              )}
              <p className="menu-row-status" id="sync-status-line" role="status">
                {sentence}
              </p>
            </li>
            <li>
              <button
                type="button"
                className="menu-row"
                disabled={refreshing}
                onClick={() => {
                  setRefreshing(true)
                  void refreshApp()
                }}
              >
                <RefreshCw size={22} className={refreshing ? 'spinning' : undefined} />
                {refreshing ? t('account.refreshing') : t('account.refresh')}
              </button>
            </li>
            <li>
              <a className="menu-row" href="/privacidade.html" target="_blank" rel="noopener">
                <ShieldCheck size={22} aria-hidden="true" />
                {t('privacy.link')}
              </a>
            </li>
            <li>
              <button type="button" className="menu-row" onClick={() => setSheet('signOut')}>
                <LogOut size={22} />
                {t('account.signOut')}
              </button>
            </li>
          </ul>
        </BottomSheet>
      )}
      {sheet === 'signOut' && (
        <ConfirmSheet
          title={t('account.signOutTitle')}
          body={t('account.signOutBody')}
          // Without internet, entering again has to wait for a connection.
          note={navigator.onLine === false ? t('account.signOutOffline') : undefined}
          confirmLabel={t('account.signOut')}
          onConfirm={onSignOut}
          onClose={() => setSheet(null)}
        />
      )}
    </header>
  )
}
