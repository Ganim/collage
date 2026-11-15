import { useEffect, useState } from 'react'
import { useSyncStatus } from '../../sync/status'
import { useOtherOwner } from '../../sync/useSync'
import { signIn, type Account } from '../account/account'
import { BottomSheet } from '../components/BottomSheet'
import { t } from '../i18n'

const promptKey = (email: string) => `collage.connectDriveAsked:${email}`

/** Whether this device already offered this account to connect the Drive. */
export function wasConnectOffered(email: string): boolean {
  try {
    return localStorage.getItem(promptKey(email)) !== null
  } catch {
    // Storage refused: count it as offered rather than offer on every visit.
    return true
  }
}

function rememberConnectOffered(email: string): void {
  try {
    localStorage.setItem(promptKey(email), String(Date.now()))
  } catch {
    // Private tabs may refuse: the account menu still offers to connect.
  }
}

/**
 * Offers once per account on this device to connect the Drive, to people who signed in before
 * the app could sync (or left the Drive unchecked). The account menu keeps offering it.
 */
export function ConnectDriveSheet({ account }: { account: Account }) {
  const needsDrive = useSyncStatus((s) => s.state === 'needsDrive')
  // The question about another account's work comes first.
  const otherPending = useOtherOwner((s) => s.other !== null)
  // Read once as the list opens: marking it below must not hide the sheet being shown.
  const [offeredBefore] = useState(() => wasConnectOffered(account.email))
  const [closed, setClosed] = useState(false)
  const open = needsDrive && !otherPending && !offeredBefore && !closed

  useEffect(() => {
    if (open) rememberConnectOffered(account.email)
  }, [open, account.email])

  if (!open) return null
  const close = () => setClosed(true)
  return (
    <BottomSheet title={t('sync.connect')} onClose={close}>
      <p className="confirm-body">{t('sync.connectBody')}</p>
      <div className="sheet-buttons">
        <button type="button" className="secondary-button" onClick={close}>
          {t('sync.connectLater')}
        </button>
        <button type="button" className="primary-button" onClick={signIn}>
          {t('sync.connectYes')}
        </button>
      </div>
    </BottomSheet>
  )
}
