// =============================================================================
// agente: punto de entrada del renderer de la ventana de agente. Fija el idioma, hace el arranque
// común (`util/arranqueRenderer`) y monta solo el agente, sin `App`, el editor ni los stores de
// la ventana principal, bajo un ErrorBoundary raíz y sin StrictMode (abriría dos sesiones).
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import './util/idiomaArranque'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from './comun/ErrorBoundary'
import { VentanaAgente } from './features/agentes/ventanaAgente/VentanaAgente'
import { arrancarRenderer } from './util/arranqueRenderer'
import { txVentanaAgente } from './features/agentes/ventanaAgente/textosVentana.ts'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import './comun/selectDesplegable.css'
import './features/agentes/ventanaAgente/ventanaAgente.css'

arrancarRenderer()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ErrorBoundary variant="full" label={txVentanaAgente().etiquetaRaiz}>
    <VentanaAgente />
  </ErrorBoundary>
)
