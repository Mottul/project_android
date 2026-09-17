import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

/**
 * Cross-origin isolation unlocks SharedArrayBuffer and therefore the
 * multi-threaded ffmpeg core. The dev and preview servers can simply send the
 * headers; GitHub Pages cannot send any headers at all, so in production the
 * service worker re-serves every response with them attached (see src/sw.ts).
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
}

export default defineConfig({
  /**
   * Relative base, matching the repository convention that every path inside an
   * app is relative so the folder can be renamed or moved without touching
   * code. Here it also means one build works unchanged at
   * https://mottul.github.io/project_android/prism/ and at
   * http://localhost:8080/prism/.
   */
  base: './',

  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      /**
       * injectManifest rather than generateSW: the worker has to do something
       * Workbox cannot express — rewrite response headers for cross-origin
       * isolation. Only one worker can own a scope, so the caching and the
       * header rewriting have to live in the same file.
       */
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: null, // registered by hand in src/register-sw.ts
      registerType: 'prompt',

      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // The ffmpeg cores are ~62 MB across both variants. They are cached on
        // first use instead of being precached.
        globIgnores: ['**/ffmpeg/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },

      manifest: {
        name: 'Prism — Medienkonverter',
        short_name: 'Prism',
        description:
          'Video, Bild und Audio in jedes gängige Format umwandeln — vollständig auf dem eigenen Gerät, ohne Upload.',
        lang: 'de',
        dir: 'ltr',
        // Relative, so the app does not hardcode its folder inside the repo.
        start_url: './index.html',
        scope: './',
        id: './',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        theme_color: '#15161f',
        background_color: '#15161f',
        categories: ['utilities', 'productivity', 'photo', 'video'],
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
        // Lets the OS hand files to the installed app ("Öffnen mit Prism").
        file_handlers: [
          {
            action: './index.html',
            accept: {
              'video/*': ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'],
              'image/*': [
                '.jpg', '.jpeg', '.png', '.webp', '.avif',
                '.gif', '.tif', '.tiff', '.bmp', '.heic',
              ],
              'audio/*': ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.opus'],
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

  optimizeDeps: {
    // ffmpeg.wasm ships its own worker + wasm glue and must not be pre-bundled.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    // Declared up front because these are only reached from inside a component
    // body. Discovered late, they trigger a re-optimisation mid-load and the
    // page ends up holding React and React-DOM from two different dep builds,
    // which surfaces as "Invalid hook call".
    include: ['react', 'react-dom/client', 'zustand', 'zustand/react/shallow'],
  },

  server: { headers: crossOriginIsolation, port: 5180 },
  preview: { headers: crossOriginIsolation, port: 5181 },
  build: { target: 'es2022', sourcemap: true },
})
