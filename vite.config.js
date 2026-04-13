import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Ex Libris Omnium',
        short_name: 'Ex Libris',
        description: 'Track, share, and discover books with friends',
        theme_color: '#1a1208',
        background_color: '#f5f0e8',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icons.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MB — mapbox-gl is large
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/covers\.openlibrary\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'book-covers',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      }
    })
  ],
})
