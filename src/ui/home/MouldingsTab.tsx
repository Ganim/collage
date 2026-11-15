import { t } from '../i18n'
import { ComingSoonIllustration } from '../illustrations'

export function MouldingsTab() {
  return (
    <div className="home-message glass">
      <ComingSoonIllustration />
      <h2>{t('mouldings.title')}</h2>
      <p>{t('mouldings.body')}</p>
    </div>
  )
}
