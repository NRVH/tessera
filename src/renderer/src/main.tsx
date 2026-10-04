// =============================================================================
// main: punto de entrada del renderer. Publica el tema y la plataforma antes de montar
// nada, instala la red de seguridad de errores asíncronos y monta `App` bajo un
// ErrorBoundary raíz, sin StrictMode.
// Depende de `App`, `comun/ErrorBoundary`, `theme/atomOneDark`, `theme/chromeVentana` y
// `util/diagnosticoRendimiento` (el diagnóstico apagado que se enciende con F12).
// =============================================================================

import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './comun/ErrorBoundary'
import { applyTheme } from './theme/atomOneDark'
import { marcarPlataforma, seguirSemaforo } from './theme/chromeVentana'
import { instalarDiagnosticoRendimiento } from './util/diagnosticoRendimiento'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

// El tema se escribe antes de montar nada, no en un efecto de App: la hoja consume
// variables (`var(--bg)`, `var(--accent)`…) que `applyTheme` publica en `:root`, y si App
// lanza en su primer render el fallback del ErrorBoundary las necesita ya definidas.
applyTheme('dark')

// La plataforma se marca en el mismo sitio y por el mismo motivo: decide de qué lado de la
// barra de título va el hueco de los botones de la ventana, y hacerlo en un efecto pintaría
// el primer fotograma con el hueco en el lado equivocado. El ancho del hueco lo da Chromium
// en `env(titlebar-area-*)` (ver `theme/chromeVentana.ts`).
marcarPlataforma()
// En Mac el hueco además se cierra mientras el semáforo no está (pantalla completa). Va
// antes de montar: lee el estado con el que nace el documento (una recarga en pantalla
// completa no recibe ningún evento) y ningún `geometrychange` llega antes que su escucha.
seguirSemaforo()
// Apagado hasta que alguien lo enciende desde las herramientas de desarrollo o una prueba.
instalarDiagnosticoRendimiento()

// Red de seguridad para errores asíncronos del renderer (promesas de IPC sin catch,
// callbacks, timers): se loguean con prefijo y no tumban la UI. Los errores de render los
// cubre el ErrorBoundary.
// Aplana un error/razón a una línea (con stack si lo hay) para el crash-log del main.
function flattenError(x: unknown): string {
  if (x instanceof Error) return `${x.name}: ${x.message}${x.stack ? `\n${x.stack}` : ''}`
  if (typeof x === 'string') return x
  try {
    return JSON.stringify(x)
  } catch {
    return String(x)
  }
}
// Ruido benigno de Monaco: al hacer dispose de un editor/diff lanza su cancelación (un error
// cuyo name y message son ambos "Canceled") y carreras de dispose del modelo. El patrón es
// estrecho a propósito: no casa un error real cuyo mensaje empiece por "Canceled: <fallo>".
// Solo se omite el crash-log en disco; en consola se sigue viendo como debug.
function isBenignEditorNoise(detail: string): boolean {
  return (
    detail === 'Canceled' ||
    /^Canceled: Canceled\b/.test(detail) ||
    detail.includes('TextModel got disposed')
  )
}
window.addEventListener('error', (e) => {
  const detail = flattenError(e.error ?? e.message)
  if (isBenignEditorNoise(detail)) {
    console.debug('[ui] ruido benigno de editor (no se persiste):', detail)
    return
  }
  console.error('[ui] error no capturado:', e.error ?? e.message)
  // Además de la consola, vuélcalo al crash-log en disco (diagnóstico post-mortem).
  window.tessera?.reportCrash?.({ tag: 'renderer:error', detail })
})
window.addEventListener('unhandledrejection', (e) => {
  const detail = flattenError(e.reason)
  if (isBenignEditorNoise(detail)) {
    console.debug('[ui] ruido benigno de editor (no se persiste):', detail)
    return
  }
  console.error('[ui] promesa rechazada sin catch:', e.reason)
  window.tessera?.reportCrash?.({ tag: 'renderer:unhandledrejection', detail })
})

// Sin React.StrictMode: la terminal tiene efectos con lado real (abre una sesión de docker
// exec en el bootstrap) y el doble montaje abriría dos sesiones. ErrorBoundary raíz: un
// error de render pinta un fallback con "Recargar" en vez de dejar la ventana en blanco.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ErrorBoundary variant="full" label="la interfaz">
    <App />
  </ErrorBoundary>
)
