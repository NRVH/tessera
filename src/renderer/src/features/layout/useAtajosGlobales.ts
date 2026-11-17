// =============================================================================
// Atajos globales de la ventana (en burbuja) y zoom: Ctrl+` (terminal; Control
// también en macOS), el agente de datos y el de la terminal, zoom con teclado y rueda, Configuración,
// buscar en archivos y archivo nuevo o consola nueva. El listener se registra UNA
// vez y lee el estado vivo por ref o del store. Cada cambio de zoom se persiste.
// =============================================================================
import { useCallback, useEffect, useRef } from 'react'
import { esAlternarAgente, esCtrlLiteral, esModPrincipal } from '../../util/atajos'
import { hayModalAbierto } from '../../util/modalAbierto'
import type { VistaActividad, PanelInferior } from './RielActividadPuro'
import { guardarAjustes, useStoreAjustes } from '../ajustes'
import { abrirBusqueda } from '../busqueda'
import { useStoreMosaico } from '../mosaico'
import { useStoreLayout } from './store'

/** Lo que los atajos necesitan de la ventana. */
export interface EntradaAtajos {
  vistaActiva: VistaActividad
  alternarPanelInferior: (cual: PanelInferior) => void
  abrirPanelInferior: (cual: PanelInferior) => void
  alternarAgenteDb: () => void
  /** Muestra u oculta el agente de la terminal (solo con la terminal a pantalla completa). */
  alternarAgenteTerminal: () => void
  nuevaConsolaEnContexto: () => void
  nuevaPestanaSinTitulo: () => void
}

/** ¿Está la terminal a pantalla completa? El store ya trae el valor coherente: lo corrige cada render. */
function terminalAPantallaCompleta(): boolean {
  return useStoreLayout.getState().franjaPantallaCompleta === 'terminal'
}

/** Refresca el espejo que pinta la fila de Zoom: `webFrame` es la verdad. */
function espejarZoom(): void {
  useStoreAjustes.setState({ zoomLevel: window.tessera.zoom.obtenerNivel() })
}

/**
 * Ctrl+` y el agente de datos (en BD) o el de la terminal (a pantalla completa): van antes del filtro
 * del modificador principal. Devuelve si lo atendió.
 */
function atajoSinModPrincipal(e: KeyboardEvent, a: EntradaAtajos, vista: VistaActividad): boolean {
  if (esCtrlLiteral(e) && e.key === '`') {
    e.preventDefault()
    // En el mosaico la franja no se ve; en BD se va a Archivos y se ABRE, sin alternar.
    if (useStoreMosaico.getState().mosaicoActivo) return true
    if (vista === 'db') a.abrirPanelInferior('terminal')
    else a.alternarPanelInferior('terminal')
    return true
  }
  if ((vista === 'db' || terminalAPantallaCompleta()) && esAlternarAgente(e)) {
    e.preventDefault()
    // La autorrepetición se consume sin actuar: no debe hacer parpadear la columna.
    if (e.repeat || useStoreMosaico.getState().mosaicoActivo) return true
    if (hayModalAbierto()) return true
    if (vista === 'db') a.alternarAgenteDb()
    else a.alternarAgenteTerminal()
    return true
  }
  return false
}

/** Zoom con teclado (Mod +, =, -, _, 0). Devuelve si lo atendió. */
function atajoZoom(e: KeyboardEvent, persistirZoom: () => void): boolean {
  if (e.key !== '+' && e.key !== '=' && e.key !== '-' && e.key !== '_' && e.key !== '0') return false
  const zoom = window.tessera.zoom
  e.preventDefault()
  if (e.key === '0') zoom.restablecer()
  else if (e.key === '-' || e.key === '_') zoom.alejar()
  else zoom.acercar()
  espejarZoom()
  persistirZoom()
  return true
}

/** Mod+N: archivo nuevo, o consola nueva en contexto en la vista de BD. */
function atajoNuevo(e: KeyboardEvent, a: EntradaAtajos, vista: VistaActividad): void {
  e.preventDefault()
  if (useStoreMosaico.getState().mosaicoActivo) return
  // En BD, Mod+N es una consola nueva en contexto, nunca un archivo en un editor que no se ve.
  if (vista === 'db') {
    if (e.repeat || hayModalAbierto()) return
    a.nuevaConsolaEnContexto()
    return
  }
  a.nuevaPestanaSinTitulo()
}

/** Atajos con el modificador principal (Ctrl en Windows, ⌘ en macOS). */
function atajoModPrincipal(e: KeyboardEvent, a: EntradaAtajos, vista: VistaActividad, persistirZoom: () => void): void {
  if (atajoZoom(e, persistirZoom)) return
  if (e.key === ',' && !e.shiftKey && !e.altKey) {
    e.preventDefault()
    useStoreAjustes.getState().alternarAjustes()
  } else if (e.shiftKey && (e.key === 'F' || e.key === 'f') && !e.altKey) {
    // Con el modal abierto no se reabre: se le devuelve el foco. En el mosaico, nada.
    e.preventDefault()
    if (!useStoreMosaico.getState().mosaicoActivo) abrirBusqueda()
  } else if ((e.key === 'n' || e.key === 'N') && !e.shiftKey && !e.altKey) {
    atajoNuevo(e, a, vista)
  }
}

/** Registra los atajos globales y el zoom con la rueda; devuelve el cambio de zoom del stepper. */
export function useAtajosGlobales(entrada: EntradaAtajos): (nivel: number) => void {
  const entradaRef = useRef(entrada)
  entradaRef.current = entrada
  useEffect(() => {
    let temporizadorGuardado: ReturnType<typeof setTimeout> | undefined
    // La rueda dispara ráfagas: se persiste con espera.
    function persistirZoom(): void {
      clearTimeout(temporizadorGuardado)
      temporizadorGuardado = setTimeout(() => guardarAjustes('zoom'), 250)
    }
    function alPulsarTecla(e: KeyboardEvent): void {
      const a = entradaRef.current
      if (atajoSinModPrincipal(e, a, a.vistaActiva)) return
      if (!esModPrincipal(e)) return
      atajoModPrincipal(e, a, a.vistaActiva, persistirZoom)
    }
    // `ctrlKey` también llega sintetizado en el pellizco del trackpad: se acepta.
    function alGirarRueda(e: WheelEvent): void {
      if (!esModPrincipal(e) && !e.ctrlKey) return
      e.preventDefault()
      if (e.deltaY < 0) window.tessera.zoom.acercar()
      else if (e.deltaY > 0) window.tessera.zoom.alejar()
      espejarZoom()
      persistirZoom()
    }
    window.addEventListener('keydown', alPulsarTecla)
    window.addEventListener('wheel', alGirarRueda, { passive: false })
    return () => {
      clearTimeout(temporizadorGuardado)
      window.removeEventListener('keydown', alPulsarTecla)
      window.removeEventListener('wheel', alGirarRueda)
    }
  }, [])
  // El mismo zoom desde su fila de Configuración, con su propia espera.
  const guardarZoomRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const cambiarZoom = useCallback((nivel: number) => {
    window.tessera.zoom.fijarNivel(nivel)
    espejarZoom()
    clearTimeout(guardarZoomRef.current)
    guardarZoomRef.current = setTimeout(() => guardarAjustes('zoom'), 250)
  }, [])
  useEffect(() => () => clearTimeout(guardarZoomRef.current), [])
  // Re-siembra el espejo cada vez que se abre Configuración.
  const ajustesAbiertos = useStoreAjustes((s) => s.ajustesAbiertos)
  useEffect(() => {
    if (ajustesAbiertos) espejarZoom()
  }, [ajustesAbiertos])
  return cambiarZoom
}
