// =============================================================================
// main: punto de entrada del renderer de la ventana principal. Fija el idioma, hace el arranque
// común de todo renderer (tema, plataforma, red de errores: `util/arranqueRenderer`) y monta `App`
// bajo un ErrorBoundary raíz, sin StrictMode. La ventana de agente tiene su propia entrada
// (`agente.tsx`) para no cargar el editor ni el resto de la aplicación.
// =============================================================================

import './util/idiomaArranque'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './comun/ErrorBoundary'
import { arrancarRenderer } from './util/arranqueRenderer'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import './comun/selectDesplegable.css'

arrancarRenderer()

// Sin React.StrictMode: la terminal tiene efectos con lado real (abre una sesión de docker
// exec en el bootstrap) y el doble montaje abriría dos sesiones. ErrorBoundary raíz: un
// error de render pinta un fallback con "Recargar" en vez de dejar la ventana en blanco.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ErrorBoundary variant="full" label="la interfaz">
    <App />
  </ErrorBoundary>
)
