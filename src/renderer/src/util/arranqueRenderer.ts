// =============================================================================
// Lo que hace todo renderer de Tessera antes de montar nada (la ventana principal y la de agente):
// publica el tema y la plataforma, enciende el diagnóstico apagado, las barras al desplazar y el
// vigía (alpha), e instala la red de seguridad de errores asíncronos. El idioma lo fija antes
// `util/idiomaArranque`, que cada entrada importa la primera.
// =============================================================================

import { instalarBarrasAlDesplazar } from '../comun/barrasDesplazamiento'
import { applyTheme } from '../theme/atomOneDark'
import { marcarPlataforma, seguirSemaforo } from '../theme/chromeVentana'
import { instalarDiagnosticoRendimiento } from './diagnosticoRendimiento'
import { arrancarVigiaRendimiento } from './vigiaRendimiento'

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
  return detail === 'Canceled' || /^Canceled: Canceled\b/.test(detail) || detail.includes('TextModel got disposed')
}

/**
 * Red de seguridad para errores asíncronos del renderer (promesas de IPC sin catch, callbacks,
 * timers): se registran con prefijo y no tumban la UI. Los de render los cubre el ErrorBoundary.
 */
function instalarRedDeErrores(): void {
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
}

/** Todo lo previo a montar React, en este orden. */
export function arrancarRenderer(): void {
  // El tema se escribe antes de montar nada, no en un efecto: la hoja consume variables
  // (`var(--bg)`, `var(--accent)`…) que `applyTheme` publica en `:root`, y si el primer render
  // lanza, el fallback del ErrorBoundary las necesita ya definidas.
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
  // La pastilla de una zona se ve mientras se desplaza, aunque el ratón no esté en ella.
  instalarBarrasAlDesplazar()
  // Solo en alpha: lo que le va lento a la ventana, para el registro de salud (el main decide si anota).
  if (window.tessera.esAlpha) arrancarVigiaRendimiento(window.tessera.salud)
  instalarRedDeErrores()
}
