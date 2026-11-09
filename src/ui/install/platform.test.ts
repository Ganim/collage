import { describe, expect, it } from 'vitest'
import { isDismissalActive, shouldSuggestInstall } from './platform'

const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1'
const IN_APP_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const env = { ua: SAFARI_IPHONE, standalone: false, dismissed: false }

describe('isDismissalActive', () => {
  const now = 1_000_000_000_000
  const hour = 60 * 60 * 1000

  it('is off when it was never dismissed', () => {
    expect(isDismissalActive(null, now)).toBe(false)
  })

  it('lasts through the same day', () => {
    expect(isDismissalActive(String(now - 23 * hour), now)).toBe(true)
  })

  it('ends after a day, so later visits suggest it again', () => {
    expect(isDismissalActive(String(now - 25 * hour), now)).toBe(false)
  })

  it('treats the older permanent dismissal as expired', () => {
    expect(isDismissalActive('1', now)).toBe(false)
  })
})

describe('shouldSuggestInstall', () => {
  it('suggests it in Safari on an iPhone', () => {
    expect(shouldSuggestInstall(env)).toBe(true)
  })

  it('does not suggest it once installed', () => {
    expect(shouldSuggestInstall({ ...env, standalone: true })).toBe(false)
  })

  it('does not suggest it again after being dismissed', () => {
    expect(shouldSuggestInstall({ ...env, dismissed: true })).toBe(false)
  })

  it.each([
    ['Chrome on iPhone', CHROME_IPHONE],
    ['an app browser on iPhone', IN_APP_IPHONE],
    ['Android', ANDROID],
    ['desktop', DESKTOP],
  ])('does not suggest it on %s', (_name, ua) => {
    expect(shouldSuggestInstall({ ...env, ua })).toBe(false)
  })
})
