import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fuentes de los temas de Personalización (solo alfabeto latino, empaquetadas con la app).
import '@fontsource/press-start-2p/latin-400.css'
import '@fontsource/vt323/latin-400.css'
import '@fontsource/archivo-black/latin-400.css'
import '@fontsource/rajdhani/latin-500.css'
import '@fontsource/rajdhani/latin-700.css'
import '@fontsource/righteous/latin-400.css'
import './index.css'
import './themes.css'
import './themes-extra.css'
import './layouts.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
