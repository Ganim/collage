import { Heart, LogOut } from 'lucide-react'
import { useState } from 'react'
import type { Account } from '../account/account'
import { BottomSheet } from '../components/BottomSheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { t } from '../i18n'

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

  return (
    <header className="account-header">
      <h1 className="brand">
        {t('app.name')}
        <Heart size={16} aria-hidden="true" />
      </h1>
      <button
        type="button"
        className="avatar-button"
        aria-label={t('account.open')}
        onClick={() => setSheet('account')}
      >
        <Avatar account={account} size="small" />
      </button>

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
          confirmLabel={t('account.signOut')}
          onConfirm={onSignOut}
          onClose={() => setSheet(null)}
        />
      )}
    </header>
  )
}
