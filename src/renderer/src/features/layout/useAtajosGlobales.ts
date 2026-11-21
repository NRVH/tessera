// =============================================================================
// Atajos globales de la ventana (en burbuja) y zoom: Ctrl+` (terminal; Control
// también en macOS), el agente de datos y el de la terminal, zoom con teclado y rueda, Configuración,
// buscar en archivos y archivo nuevo o consola nueva. En las ventanas hijas desacopladas solo se
// atienden los atajos de la franja y la terminal (Ctrl+`, Ctrl+Alt+B/⌥⌘B y zoom); los del editor
// o el proyecto principal (Mod+N, Mod+Shift+F, Mod+,) quedan solo en la principal.
// Cada cambio de zoom se persiste y el main sincroniza todas las ventanas.
// =============================================================================
import { useCallback, useEffect, useRef } from 'react'
import { esAlternarAgente, esCtrlLiteral, esModPrincipal } from '../../util/atajos'
import { hayModalAbierto } from '../../util/modalAbierto'
import { enfocarPanel, type VistaActividad, type PanelInferior } from './RielActividadPuro'
import { guardarAjustes, useStoreAjustes } from '../ajustes'
import { abrirBusqueda } from '../busqueda'
import { useStoreMosaico } from '../mosaico'
import { panelDeHija } from './franjaDesacoplada'
import { useStoreLayout } from './store'
import { enfocarFranjaDesacoplada, useStoreVentanasFranja, type VentanaFranja } from './ventanasFranja'

/** Lo que los atajos necesitan de la ventana. */
export interface EntradaAtajos {
  vistaActiva: VistaActividad
  alternarPanelInferior: (cual: PanelInferior) => void
  abrirPanelInferior: (cual: PanelInferior) => void
  alternarAgenteDb: () => void
  /** Muestra u oculta el agente de la terminal del perfil indicado (o del activo). */
  alternarAgenteTerminal: (perfilId?: string) => void
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
    // En el mosaico la franja no se ve; si está desacoplada, trae su ventana al frente y enfoca la terminal.
    if (useStoreMosaico.getState().mosaicoActivo) return true
    const perfil = useStoreLayout.getState().perfilALaVista
    const hija = useStoreVentanasFranja.getState().abiertas.get(perfil)
    if (hija) {
      if (e.repeat) return true
      if (panelDeHija(useStoreLayout.getState().panelPorPerfil[perfil], hija.panelInicial) !== 'terminal') {
        useStoreLayout.setState((s) => ({
          franjaLibre: true,
          panelPorPerfil: { ...s.panelPorPerfil, [perfil]: 'terminal' }
        }))
      }
      enfocarFranjaDesacoplada(perfil, (doc) => enfocarPanel('terminal', doc))
      return true
    }
    if (vista === 'db') a.abrirPanelInferior('terminal')
    else a.alternarPanelInferior('terminal')
    return true
  }
  if ((vista === 'db' || terminalAPantallaCompleta()) && esAlternarAgente(e)) {
    e.preventDefault()
    // La autorrepetición se consume sin actuar: no debe hacer parpadear la columna.
    if (e.repeat || useStoreMosaico.getState().mosaicoActivo) return true
    if (hayModalAbierto(document)) return true
    if (vista === 'db') a.alternarAgenteDb()
    else a.alternarAgenteTerminal()
    return true
  }
  return false
}

/** Atajos de una ventana hija desacoplada: solo los de la terminal, la franja y el zoom. */
function atajoEnHija(e: KeyboardEvent, perfil: string, hija: VentanaFranja, a: EntradaAtajos, persistirZoom: () => void): void {
  const doc = hija.ventana.document
  const panelActual = panelDeHija(useStoreLayout.getState().panelPorPerfil[perfil], hija.panelInicial)
  if (esCtrlLiteral(e) && e.key === '`') {
    e.preventDefault()
    if (hayModalAbierto(doc)) return
    if (panelActual !== 'terminal') {
      useStoreLayout.setState((s) => ({
        franjaLibre: true,
        panelPorPerfil: { ...s.panelPorPerfil, [perfil]: 'terminal' }
      }))
    }
    enfocarPanel('terminal', doc)
    return
  }
  if (esAlternarAgente(e)) {
    e.preventDefault()
    if (e.repeat || hayModalAbierto(doc) || hija.marco.classList.contains('franja-compacta')) return
    a.alternarAgenteTerminal(perfil)
    return
  }
  if (!esModPrincipal(e)) return
  atajoZoom(e, persistirZoom)
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
    if (e.repeat || hayModalAbierto(document)) return
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

/** Registra los atajos globales y el zoom con la rueda en la principal y en las hijas; devuelve el cambio de zoom del stepper. */
export function useAtajosGlobales(entrada: EntradaAtajos): (nivel: number) => void {
  const entradaRef = useRef(entrada)
  entradaRef.current = entrada
  const temporizadorZoomRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const abiertas = useStoreVentanasFranja((s) => s.abiertas)

  // La rueda dispara ráfagas: se persiste con espera (el main sincroniza el zoom a las hijas).
  const persistirZoom = useCallback((): void => {
    clearTimeout(temporizadorZoomRef.current)
    temporizadorZoomRef.current = setTimeout(() => guardarAjustes('zoom'), 250)
  }, [])
  useEffect(() => () => clearTimeout(temporizadorZoomRef.current), [])

  // `ctrlKey` también llega sintetizado en el pellizco del trackpad: se acepta.
  const alGirarRueda = useCallback(
    (e: WheelEvent): void => {
      if (!esModPrincipal(e) && !e.ctrlKey) return
      e.preventDefault()
      if (e.deltaY < 0) window.tessera.zoom.acercar()
      else if (e.deltaY > 0) window.tessera.zoom.alejar()
      espejarZoom()
      persistirZoom()
    },
    [persistirZoom]
  )

  useEffect(() => {
    function alPulsarTecla(e: KeyboardEvent): void {
      const a = entradaRef.current
      if (atajoSinModPrincipal(e, a, a.vistaActiva)) return
      if (!esModPrincipal(e)) return
      atajoModPrincipal(e, a, a.vistaActiva, persistirZoom)
    }
    window.addEventListener('keydown', alPulsarTecla)
    window.addEventListener('wheel', alGirarRueda, { passive: false })
    return () => {
      window.removeEventListener('keydown', alPulsarTecla)
      window.removeEventListener('wheel', alGirarRueda)
    }
  }, [alGirarRueda, persistirZoom])

  useEffect(() => {
    const bajas: (() => void)[] = []
    for (const [perfil, hija] of abiertas) {
      const ventana = hija.ventana
      if (ventana.closed) continue
      const alPulsar = (e: KeyboardEvent): void => atajoEnHija(e, perfil, hija, entradaRef.current, persistirZoom)
      ventana.addEventListener('keydown', alPulsar)
      ventana.addEventListener('wheel', alGirarRueda, { passive: false })
      bajas.push(() => {
        ventana.removeEventListener('keydown', alPulsar)
        ventana.removeEventListener('wheel', alGirarRueda)
      })
    }
    return () => {
      for (const bajar of bajas) bajar()
    }
  }, [abiertas, alGirarRueda, persistirZoom])

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
