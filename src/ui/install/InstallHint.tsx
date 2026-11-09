import { Share, SquarePlus } from 'lucide-react'
import { useState } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { t } from '../i18n'
import { readInstallEnv, rememberDismissed, shouldSuggestInstall } from './platform'

export function InstallHint() {
  const [open, setOpen] = useState(() => shouldSuggestInstall(readInstallEnv()))
  if (!open) return null

  const dismiss = () => {
    rememberDismissed()
    setOpen(false)
  }

  return (
    <BottomSheet title={t('install.title')} onClose={dismiss}>
      <p className="install-why">{t('install.why')}</p>
      <ol className="install-steps">
        <li>
          <Share size={22} />
          {t('install.stepShare')}
        </li>
        <li>
          <SquarePlus size={22} />
          {t('install.stepAdd')}
        </li>
      </ol>
      <button type="button" className="primary-button install-dismiss" onClick={dismiss}>
        {t('install.dismiss')}
      </button>
    </BottomSheet>
  )
}
