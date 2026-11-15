import { answerOtherOwner, useOtherOwner } from '../../sync/useSync'
import type { Account } from '../account/account'
import { BottomSheet } from '../components/BottomSheet'
import { t } from '../i18n'

/**
 * Asks once per account whether this device's collections from another account go to this one.
 * Closing the sheet counts as "Deixar só neste aparelho".
 */
export function OtherAccountSheet({ account }: { account: Account }) {
  const other = useOtherOwner((s) => s.other)
  if (!other) return null
  return (
    <BottomSheet title={t('sync.otherAccountTitle')} onClose={() => void answerOtherOwner('keep')}>
      <p className="confirm-body">
        {t('sync.otherAccountBody', {
          count: other.count,
          email: other.email,
          current: account.email,
        })}
      </p>
      <div className="sheet-buttons">
        <button
          type="button"
          className="secondary-button"
          onClick={() => void answerOtherOwner('keep')}
        >
          {t('sync.otherAccountNo')}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => void answerOtherOwner('copy')}
        >
          {t('sync.otherAccountYes')}
        </button>
      </div>
    </BottomSheet>
  )
}
