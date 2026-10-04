// =============================================================================
// Ciclo de vida del xterm que comparten la terminal de shell y la del agente: crearlo
// con sus addons, cablear teclado, pegado y arrastre, conectarlo con su sesión y
// desmontarlo, más el WebGL que solo tiene el pane en pantalla. Cada pane pone lo suyo
// por opciones (canal, tema, fin de la sesión, qué hacer con las rutas soltadas). Sin React.
// Decisiones: docs/decisiones/terminales/ciclo-del-xterm-comun.md
// =============================================================================

import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardAddon, Base64 } from '@xterm/addon-clipboard'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { xtermThemeConCursor } from '../../theme/atomOneDark'
import { resolveFontFamily, resolveFontSize } from '../../theme/terminalAppearance'
import { desecharWebgl, detectGpuRenderer } from '../../util/gpuRenderer'
import { medirDuracion } from '../../util/diagnosticoRendimiento'
import { crearManejadorAtajos, type AccionesAtajos } from './atajosTerminal'
import type { ResultadosBusqueda } from './buscadorXterm'
import { filesToPaths } from './clipboardPaste'
import { tesseraClipboardProvider } from './clipboardProvider'
import { conectarSesion, desmontarXterm, type CanalPty, type RefsXterm } from './sesionXterm'

/** Lo que distingue a cada pane en el montaje común. */
export interface OpcionesMontaje<Salida extends { sessionId: string }> {
  /** Tema base sobre el que se tiñe el cursor; sin él, el del agente. */
  tema?: ITheme
  canal: CanalPty<Salida>
  /** La sesión del momento: el filtro de la salida, del teclado y del fin. */
  idSesion: () => string | null
  /** Fin de NUESTRA sesión (ya filtrado). */
  alSalir: (term: Terminal, msg: Salida) => void
  setSearchResults: (r: ResultadosBusqueda | null) => void
  atajos: AccionesAtajos
  /** Pegado por vías que no son el teclado (y Mod+V, que no previene el evento). */
  pegar: (e: ClipboardEvent) => void
  /** Archivos del sistema soltados sobre la terminal con la sesión `id` viva. */
  soltarRutas: (id: string, rutas: string[]) => void
  ajustarConRebote: () => void
  /** Olvida la sesión y la cierra en el main: el único camino por el que muere al desmontar. */
  cerrarSesion: () => void
}

/** Crea el xterm con sus addons, sin abrirlo. El WebGL lo gestiona `alternarWebgl`. */
function crearXterm(refs: RefsXterm, tema: ITheme | undefined): { term: Terminal; fit: FitAddon; search: SearchAddon } {
  const term = new Terminal({
    fontFamily: resolveFontFamily(refs.appearance.current),
    fontSize: resolveFontSize(refs.appearance.current),
    lineHeight: 1.2,
    cursorBlink: true,
    // Apariencia y acento entran por ref: recrear el xterm perdería el scrollback y la sesión.
    theme: xtermThemeConCursor(refs.accent.current, tema),
    allowProposedApi: true,
    // Scrollback amplio: al arrastrar la selección hacia abajo, xterm despliega el histórico.
    scrollback: 5000
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  // OSC 52: honra el «copiar» de las TUIs y los CLIs por nuestro IPC (ver clipboardProvider).
  term.loadAddon(new ClipboardAddon(new Base64(), tesseraClipboardProvider))
  // URLs clicables: al navegador del sistema, nunca navegan el renderer.
  term.loadAddon(
    new WebLinksAddon((_e, uri) => {
      void window.tessera.openExternal(uri)
    })
  )
  const search = new SearchAddon()
  term.loadAddon(search)
  return { term, fit, search }
}

/**
 * Pegado y arrastre de archivos sobre el host. El `paste` se intercepta en CAPTURA para
 * adelantarse a la textarea de xterm, que pegaría el texto crudo; Mod+Shift+V pega por
 * IPC, así que ningún camino pega dos veces. `dragover` debe prevenir el default para
 * habilitar el drop.
 */
function instalarPegadoYArrastre<S extends { sessionId: string }>(host: HTMLElement, op: OpcionesMontaje<S>): () => void {
  const onDomPaste = (e: ClipboardEvent): void => {
    if (!op.idSesion()) return
    e.preventDefault()
    e.stopPropagation()
    op.pegar(e)
  }
  const onDragOver = (e: DragEvent): void => {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    e.preventDefault()
  }
  const onDrop = (e: DragEvent): void => {
    const id = op.idSesion()
    if (!id) return
    const paths = filesToPaths(e.dataTransfer?.files)
    if (!paths.length) return // arrastre sin archivos del sistema: no es lo nuestro
    e.preventDefault()
    e.stopPropagation()
    op.soltarRutas(id, paths)
  }
  host.addEventListener('paste', onDomPaste, true)
  host.addEventListener('dragover', onDragOver)
  host.addEventListener('drop', onDrop)
  return () => {
    host.removeEventListener('paste', onDomPaste, true)
    host.removeEventListener('dragover', onDragOver)
    host.removeEventListener('drop', onDrop)
  }
}

/** Monta el xterm del pane en `host` (sin abrir la sesión) y devuelve la función que lo desmonta. */
export function montarXterm<S extends { sessionId: string }>(host: HTMLDivElement, refs: RefsXterm, op: OpcionesMontaje<S>): () => void {
  const { term, fit, search } = crearXterm(refs, op.tema)
  refs.search.current = search
  const searchSub = search.onDidChangeResults((r) => op.setSearchResults({ index: r.resultIndex, count: r.resultCount }))
  term.open(host)
  refs.term.current = term
  refs.fit.current = fit
  term.attachCustomKeyEventHandler(crearManejadorAtajos(term, op.atajos))
  const quitarPegado = instalarPegadoYArrastre(host, op)
  const sesion = conectarSesion(term, refs, op.canal, op.idSesion, (msg) => op.alSalir(term, msg))
  // Refit ante cualquier cambio de tamaño del contenedor (ventana y zoom global).
  const ro = new ResizeObserver(() => op.ajustarConRebote())
  ro.observe(host)
  return () => {
    ro.disconnect()
    quitarPegado()
    sesion.desconectar()
    searchSub.dispose()
    desmontarXterm(host, term, sesion.flow, refs, op.cerrarSesion)
  }
}

/**
 * WebGL SOLO en el pane que está en pantalla: cada contexto cuenta contra el tope (~16)
 * de Chromium y con keep-alive hay muchos panes montados. Al salir se devuelve el
 * contexto a mano; con pérdida de contexto xterm cae al renderer DOM. `medida` anota la
 * creación en el diagnóstico de rendimiento.
 */
export function alternarWebgl(refs: RefsXterm, enPantalla: boolean, medida?: string): void {
  const term = refs.term.current
  if (!term) return
  if (enPantalla && detectGpuRenderer().useWebgl && !refs.webgl.current) {
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        if (refs.webgl.current === webgl) refs.webgl.current = null
      })
      if (medida) medirDuracion(medida, () => term.loadAddon(webgl))
      else term.loadAddon(webgl)
      refs.webgl.current = webgl
    } catch {
      /* WebGL no arrancó: xterm sigue con el renderer DOM */
    }
  } else if (!enPantalla && refs.webgl.current) {
    const webgl = refs.webgl.current
    refs.webgl.current = null
    desecharWebgl(refs.host.current, webgl)
  }
}
