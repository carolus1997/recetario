import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/recetario/', // GitHub Pages: carolus1997.github.io/recetario/
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Recetario',
        short_name: 'Recetario',
        lang: 'es',
        display: 'standalone',
        start_url: '/recetario/',
        scope: '/recetario/',
        theme_color: '#F7F1E3',
        background_color: '#F7F1E3',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
