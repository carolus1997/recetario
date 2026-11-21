import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import '@fontsource/caveat-brush/400.css'
import '@fontsource/patrick-hand/400.css'
import '@fontsource/patrick-hand-sc/400.css'
import './index.css'
import App from './App'
import { AuthProvider } from './auth'
import Sprite from './components/Sprite'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sprite />
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
