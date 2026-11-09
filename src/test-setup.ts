import '@testing-library/jest-dom/vitest'

// jsdom has no matchMedia, and the tests that run in Node have no window at all.
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query })) as typeof matchMedia
}
