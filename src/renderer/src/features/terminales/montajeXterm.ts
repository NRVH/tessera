// =============================================================================
// Ciclo de vida del xterm que comparten la terminal de shell y la del agente: crearlo
// con sus addons, cablear teclado, pegado y arrastre, conectarlo con su sesión y
// desmontarlo, más el WebGL que solo tiene el pane en pantalla. Cada pane pone lo suyo
// por opciones (canal, tema, fin de la sesión, qué hacer con las rutas soltadas). Sin React.
// Decisiones: docs/decisiones/terminales/ciclo-del-xterm-comun.md
// =============================================================================

import { Terminal, type ITheme } from '@xterm/xterm'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardAddon, Base64 } from '@xterm/addon-clipboard'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { temaXtermConCursor } from '../../theme/atomOneDark'
import { resolverFamiliaLetra, resolverTamanoLetra } from '../../theme/aparienciaTerminal'
import { desecharWebgl, detectarRendererGpu } from '../../util/rendererGpu'
import { medirDuracion } from '../../util/diagnosticoRendimiento'
import { alCambiarVentanaAnfitrion, crearObservadorTamano, documentoDe } from '../../util/ventanaDe'
import { crearManejadorAtajos, type AccionesAtajos } from './atajosTerminal'
import type { ResultadosBusqueda } from './buscadorXterm'
import { archivosARutas } from './pegadoPortapapeles'
import { proveedorPortapapelesTessera } from './proveedorPortapapeles'
import { conectarSesion, desmontarXterm, type CanalPty, type RefsXterm } from './sesionXterm'
import { estadoInicial, resaltarSalida } from './resaltadoSalida'
import { AjusteXterm } from './ajusteTamano'
import { enlazarXterm } from './ventanaXterm'

/** Lo que distingue a cada pane en el montaje común. */
export interface OpcionesMontaje<Salida extends { sessionId: string }> {
  /** Tema base sobre el que se tiñe el cursor; sin él, el del agente. */
  tema?: ITheme
  canal: CanalPty<Salida>
  /** La sesión del momento: el filtro de la salida, del teclado y del fin. */
  idSesion: () => string | null
  /** Fin de NUESTRA sesión (ya filtrado). */
  alSalir: (term: Terminal, msg: Salida) => void
  /** Sin él, el pane no tiene buscador: ni addon ni Mod+F (llega al programa). */
  setResultadosBusqueda?: (r: ResultadosBusqueda | null) => void
  atajos: AccionesAtajos
  /** Pegado por vías que no son el teclado (y Mod+V, que no previene el evento). */
  pegar: (e: ClipboardEvent) => void
  /** Archivos del sistema soltados sobre la terminal con la sesión `id` viva. */
  soltarRutas: (id: string, rutas: string[]) => void
  ajustarConRebote: () => void
  /** Olvida la sesión y la cierra en el main: el único camino por el que muere al desmontar. */
  cerrarSesion: () => void
  /** ¿Se resalta la salida? Se lee en cada trozo, así el interruptor vale sin recrear el xterm. Sin él, nunca. */
  resaltar?: () => boolean
}

/** Crea el xterm con sus addons en el documento del anfitrión, sin abrirlo. El WebGL lo gestiona `alternarWebgl`. */
function crearXterm(refs: RefsXterm, tema: ITheme | undefined, documento: Document): { term: Terminal; ajuste: AjusteXterm } {
  const term = new Terminal({
    fontFamily: resolverFamiliaLetra(refs.appearance.current),
    fontSize: resolverTamanoLetra(refs.appearance.current),
    lineHeight: 1.2,
    cursorBlink: true,
    // Apariencia y acento entran por ref: recrear el xterm perdería el scrollback y la sesión.
    theme: temaXtermConCursor(refs.accent.current, tema),
    allowProposedApi: true,
    // Si el anfitrión nace directamente en una ventana hija, xterm enlaza su documento y ventana desde el inicio.
    documentOverride: documento,
    // Scrollback amplio: al arrastrar la selección hacia abajo, xterm despliega el histórico.
    scrollback: 5000
  })
  const ajuste = new AjusteXterm(term)
  term.loadAddon(ajuste)
  // OSC 52: honra el «copiar» de las TUIs y los CLIs por nuestro IPC (ver proveedorPortapapeles).
  term.loadAddon(new ClipboardAddon(new Base64(), proveedorPortapapelesTessera))
  // URLs clicables: al navegador del sistema, nunca navegan el renderer.
  term.loadAddon(
    new WebLinksAddon((_e, uri) => {
      void window.tessera.abrirExterno(uri)
    })
  )
  return { term, ajuste }
}

/** Carga el buscador si el pane lo tiene; devuelve cómo soltar su suscripción. */
function cargarBuscador(term: Terminal, refs: RefsXterm, setResultados: OpcionesMontaje<{ sessionId: string }>['setResultadosBusqueda']): () => void {
  if (!setResultados) return () => {}
  const busqueda = new SearchAddon()
  term.loadAddon(busqueda)
  refs.search.current = busqueda
  const sub = busqueda.onDidChangeResults((r) => setResultados({ indice: r.resultIndex, total: r.resultCount }))
  return () => sub.dispose()
}

/**
 * Pegado y arrastre de archivos sobre el host. El `paste` se intercepta en CAPTURA para
 * adelantarse a la textarea de xterm, que pegaría el texto crudo; Mod+Shift+V pega por
 * IPC, así que ningún camino pega dos veces. `dragover` debe prevenir el default para
 * habilitar el drop.
 */
function instalarPegadoYArrastre<S extends { sessionId: string }>(host: HTMLElement, op: OpcionesMontaje<S>): () => void {
  const alPegarDom = (e: ClipboardEvent): void => {
    if (!op.idSesion()) return
    e.preventDefault()
    e.stopPropagation()
    op.pegar(e)
  }
  const alSobrevolarArrastre = (e: DragEvent): void => {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    e.preventDefault()
  }
  const alSoltar = (e: DragEvent): void => {
    const id = op.idSesion()
    if (!id) return
    const rutas = archivosARutas(e.dataTransfer?.files)
    if (!rutas.length) return // arrastre sin archivos del sistema: no es lo nuestro
    e.preventDefault()
    e.stopPropagation()
    op.soltarRutas(id, rutas)
  }
  host.addEventListener('paste', alPegarDom, true)
  host.addEventListener('dragover', alSobrevolarArrastre)
  host.addEventListener('drop', alSoltar)
  return () => {
    host.removeEventListener('paste', alPegarDom, true)
    host.removeEventListener('dragover', alSobrevolarArrastre)
    host.removeEventListener('drop', alSoltar)
  }
}


/**
 * Como una terminal nativa: en la pantalla alternativa no hay historial que recorrer, así que la barra de
 * xterm se esconde por CSS (arrastrarla movería la vista por debajo de lo que pinta el programa y taparía sus
 * últimas filas) y, al cambiar de pantalla, la vista vuelve al fondo. El desplazamiento es del programa. Va en
 * `data-pantalla` y no en una clase: el `className` del host lo repinta React.
 */
function seguirPantallaAlternativa(term: Terminal, host: HTMLElement): () => void {
  const marcar = (): void => {
    host.dataset.pantalla = term.buffer.active.type === 'alternate' ? 'alternativa' : 'normal'
    term.scrollToBottom()
  }
  marcar()
  const sub = term.buffer.onBufferChange(marcar)
  return () => {
    sub.dispose()
    delete host.dataset.pantalla
  }
}

/** Monta el xterm del pane en `host` (sin abrir la sesión) y devuelve la función que lo desmonta. */
export function montarXterm<S extends { sessionId: string }>(host: HTMLDivElement, refs: RefsXterm, op: OpcionesMontaje<S>): () => void {
  const { term, ajuste } = crearXterm(refs, op.tema, documentoDe(host))
  const soltarBuscador = cargarBuscador(term, refs, op.setResultadosBusqueda)
  enlazarXterm(term, host)
  refs.term.current = term
  refs.fit.current = ajuste
  term.attachCustomKeyEventHandler(crearManejadorAtajos(term, op.atajos))
  const quitarPegado = instalarPegadoYArrastre(host, op)
  const dejarPantalla = seguirPantallaAlternativa(term, host)
  const resaltar = op.resaltar
  // El estado se sigue aunque el interruptor esté apagado: al encenderlo, la pantalla alternativa y el
  // color abierto por el programa tienen que ser los de verdad.
  const estado = estadoInicial()
  const transformar = resaltar
    ? (datos: string): string => {
        const pintada = resaltarSalida(datos, estado)
        return resaltar() ? pintada : datos
      }
    : undefined
  const sesion = conectarSesion(term, refs, op.canal, op.idSesion, (msg) => op.alSalir(term, msg), transformar)
  let observador: ResizeObserver | undefined
  const observarTamano = (): void => {
    observador?.disconnect()
    observador = crearObservadorTamano(host, op.ajustarConRebote)
    observador.observe(host)
  }
  observarTamano()
  const dejarDeEscuchar = alCambiarVentanaAnfitrion(host, () => {
    enlazarXterm(term, host)
    observarTamano()
  })
  return () => {
    dejarDeEscuchar()
    observador?.disconnect()
    quitarPegado()
    dejarPantalla()
    sesion.desconectar()
    soltarBuscador()
    desmontarXterm(host, term, sesion.flujo, refs, op.cerrarSesion)
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
  if (enPantalla && detectarRendererGpu().useWebgl && !refs.webgl.current) {
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
