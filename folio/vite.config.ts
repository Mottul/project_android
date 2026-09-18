import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  /**
   * Relative base, matching the repository convention: every path inside an app
   * stays relative so the folder can be renamed or moved without touching code.
   * One build therefore works unchanged at
   * https://mottul.github.io/project_android/folio/ and at http://localhost:8080/folio/.
   */
  base: './',

  plugins: [
    VitePWA({
      /**
       * injectManifest rather than generateSW: the worker is hand written (see
       * src/sw.ts) so the caching rules stay readable next to the ones of the
       * other apps in this repository. The plugin only fills in the list of
       * built files.
       */
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: null, // registered by hand in src/register-sw.ts
      registerType: 'prompt',

      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // The pdf.js worker alone is well past the 2 MB default.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },

      manifest: {
        name: 'Folio — Dokumente lesen und bearbeiten',
        short_name: 'Folio',
        description:
          'PDF, EPUB, Bilder und Text lesen, kommentieren, markieren, bearbeiten und exportieren — vollständig auf dem eigenen Gerät.',
        lang: 'de',
        dir: 'ltr',
        start_url: './index.html',
        scope: './',
        id: './',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        theme_color: '#12151b',
        background_color: '#12151b',
        categories: ['productivity', 'books', 'utilities'],
        icons: [
          { src: './icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: './icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Lets the OS hand documents to the installed app ("Öffnen mit Folio").
        file_handlers: [
          {
            action: './index.html',
            accept: {
              'application/pdf': ['.pdf'],
              'application/epub+zip': ['.epub'],
              'text/plain': ['.txt'],
              'text/markdown': ['.md', '.markdown'],
              'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'],
            },
          },
        ],
        launch_handler: { client_mode: 'focus-existing' },
      },

      devOptions: { enabled: false },
    }),
  ],

  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },

  server: { port: 5190 },
  preview: { port: 5191 },
  build: { target: 'es2022', sourcemap: true },
})
