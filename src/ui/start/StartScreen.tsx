import { Heart, Lock } from 'lucide-react'
import { useRef, useState, type ComponentType } from 'react'
import { signIn } from '../account/account'
import { t, type MessageKey } from '../i18n'
import { FramesIllustration, PrintIllustration, WelcomeIllustration } from '../illustrations'

const STEPS: { title: MessageKey; body: MessageKey; Illustration: ComponentType }[] = [
  { title: 'start.step1', body: 'start.step1Body', Illustration: FramesIllustration },
  { title: 'start.step2', body: 'start.step2Body', Illustration: WelcomeIllustration },
  { title: 'start.step3', body: 'start.step3Body', Illustration: PrintIllustration },
]

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The official four-color "G", on the white disc Google asks for. */
function GoogleMark() {
  return (
    <span className="google-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="20" height="20">
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
    </span>
  )
}

/** Shown whenever there is no account: what the app does, and the way in. */
export function StartScreen() {
  // The sign-in service comes back to "#/entrar?erro=1" when it could not finish.
  const failed = /[?&]erro=1(&|$)/.test(location.hash)
  const [active, setActive] = useState(0)
  const track = useRef<HTMLDivElement>(null)

  const onScroll = () => {
    const el = track.current
    if (!el || el.clientWidth === 0) return
    setActive(Math.round(el.scrollLeft / el.clientWidth))
  }

  const goTo = (index: number) => {
    const el = track.current
    setActive(index)
    el?.scrollTo({ left: index * el.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  return (
    <div className="start">
      <h1 className="start-brand">
        {t('app.name')}
        <Heart size={18} aria-hidden="true" />
      </h1>

      <div
        ref={track}
        className="start-steps"
        role="region"
        aria-label={t('start.steps')}
        onScroll={onScroll}
      >
        {STEPS.map(({ title, body, Illustration }, i) => (
          <section className="start-step" key={title} aria-labelledby={`start-step-${i}`}>
            <div className="start-card glass">
              <Illustration />
              <h2 id={`start-step-${i}`}>{t(title)}</h2>
              <p>{t(body)}</p>
            </div>
          </section>
        ))}
      </div>

      <nav className="start-dots" aria-label={t('start.dots')}>
        {STEPS.map(({ title }, i) => (
          <button
            key={title}
            type="button"
            className="start-dot"
            aria-label={t('start.goTo', { position: i + 1 })}
            aria-current={i === active ? 'step' : undefined}
            onClick={() => goTo(i)}
          />
        ))}
      </nav>

      <div className="start-footer glass">
        {failed && (
          <p className="start-error" role="alert">
            {t('start.failed')}
          </p>
        )}
        <button type="button" className="primary-button google-button" onClick={signIn}>
          <GoogleMark />
          {t('start.signIn')}
        </button>
        <p className="start-privacy">
          <Lock size={14} aria-hidden="true" />
          {t('start.privacy')}
        </p>
        <a className="start-privacy-link" href="/privacidade.html" target="_blank" rel="noopener">
          {t('privacy.link')}
        </a>
      </div>
    </div>
  )
}
