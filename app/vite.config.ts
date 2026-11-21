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
        theme_color: '#1f7a4d',
        background_color: '#ffffff',
        icons: [], // pendiente: añadir iconos 192/512 para poder instalarla
      },
    }),
  ],
})
