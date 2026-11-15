/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { authMock } from './vite-auth-mock'

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    authMock(),
    VitePWA({
      // A release waits for the next launch: taking over an open page would delete the
      // files it still has to load, such as the workers behind the PDF.
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon-v2.png', 'favicon.svg', 'favicon-48.png'],
      manifest: {
        name: 'Collage',
        short_name: 'Collage',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#fdf4ff',
        theme_color: '#c026d3',
        icons: [
          { src: 'icon-192-v2.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512-v2.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,svg,woff2}'],
        // The privacy page is a page of its own, never the app's index.html.
        navigateFallbackDenylist: [/^\/api\//, /^\/privacidade\.html$/],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
