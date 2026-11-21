// =============================================================================
// BarraEstadoPuro: franja delgada al pie del shell, siempre visible, hermana de `.shell-body`.
// Solo estado: a la izquierda la rama del repo activo y el aviso o error vivo más reciente;
// a la derecha el uso de las cuentas del perfil, el fin de línea y la codificación del archivo
// activo (cada uno con su selector de menú) y el conmutador de la columna del agente. Si lo de la
// derecha no cabe, cede la marca y luego lo que la escalera diga (`useEscalonBarra.ts`).
// Depende de `shared/encodings`, `comun/notificaciones` y del tipo `EditorMeta` de `../editor`.
// =============================================================================

import { Presente } from '../../comun/Presente'
import { useUltimoValor } from '../../comun/presencia'
import { useDespedidaDe } from '../../comun/despedida'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { etiquetaEncoding, encodingOpciones } from '../../../../shared/encodings'
import { useToasts, descartarTodos, type Toast } from '../../comun/notificaciones'
import { IconoColumnaAgente } from '../../comun/iconosPanel'
import { etiquetaAcorde } from '../../util/atajos'
import type { EditorMeta } from '../editor'
import { txLayout } from './textos.ts'
import { useEscalonBarra } from './useEscalonBarra'

interface PropsBarraEstadoPuro {
  /** ¿La columna de agente (CC/Codex) está visible? (icono presionado). */
  ccVisible: boolean
  /**
   * Por qué NO se puede tocar la columna del agente ahora mismo, o `null` si sí.
   * Es un motivo y no un booleano porque hay dos (sin archivo abierto no hay nada que
   * ocultar; en vista dividida el ancho ya está comprometido) y el tooltip dice cuál.
   */
  razonBloqueoCc: string | null
  /** Muestra u oculta la columna de agente (el editor ocupa todo el ancho al ocultarla). */
  onAlternarCc: () => void
  /**
   * Tooltip del conmutador cuando SÍ se puede pulsar, o ausente para el de siempre
   * («Ocultar/Mostrar la columna del agente»). Lo decide quien sabe en qué vista estás
   * (`BarraEstadoApp`): en la vista de bases de datos el botón muestra u oculta el agente
   * de datos y, con la terminal a pantalla completa, el de la terminal. Con motivo de
   * bloqueo manda el motivo.
   */
  tituloCc?: string
  /**
   * Rama del repo ACTIVO (solo lectura). null = sin repo, HEAD detached o aún sin
   * cargar: no se pinta. No permite cambiar de rama desde aquí.
   */
  rama?: string | null
  /**
   * Codificación + EOL del archivo ACTIVO, o null si el activo no es un editor de
   * texto (diff, binario, sin título): en ese caso el bloque derecho no se pinta.
   */
  editorMeta?: EditorMeta | null
  /** Re-lee el archivo activo decodificándolo con esa codificación (no modifica disco). */
  onReabrirEncoding: (id: string) => void
  /** Reescribe el archivo activo con esa codificación (convierte en disco). */
  onGuardarEncoding: (id: string) => void
  /** Cambia el fin de línea del archivo activo (reescribe en disco). */
  onElegirEol: (eol: 'CRLF' | 'LF') => void
  /** El uso de las cuentas del perfil, al principio del bloque derecho. */
  usoCuentas?: React.ReactNode
}

/** Paso del selector de codificación/EOL abierto. */
type PasoMenuBarraEstado = 'eol' | 'action' | 'reopen' | 'save'

/** Selector abierto: el paso y el rect del botón que lo ancla. */
interface MenuAbierto {
  paso: PasoMenuBarraEstado
  ancla: DOMRect
}

type SetMenu = React.Dispatch<React.SetStateAction<MenuAbierto | null>>

/**
 * Mide el rect del botón de forma síncrona, dentro del handler: dentro del updater de
 * `setMenu` React ya habría puesto `e.currentTarget = null` y `getBoundingClientRect`
 * reventaría la UI.
 */
function obtenerAnclaBoton(e: React.MouseEvent<HTMLButtonElement>): DOMRect {
  return e.currentTarget.getBoundingClientRect()
}

export function tituloDelAgenteTerminal(activo: boolean): string {
  const t = txLayout().estado
  const acorde = etiquetaAcorde('alternarAgente')
  return activo ? t.ocultarAgenteTerminal(acorde) : t.mostrarAgenteTerminal(acorde)
}

export function BotonColumnaAgente({ activo, titulo, deshabilitado, alPulsar }: {
  activo: boolean
  titulo: string
  deshabilitado?: boolean
  alPulsar: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`status-bar-btn icon-only${activo ? ' active' : ''}`}
      onClick={alPulsar}
      disabled={deshabilitado}
      aria-label={titulo}
      aria-pressed={activo}
      title={titulo}
    >
      <IconoColumnaAgente />
    </button>
  )
}

/** Barra de estado del shell. */
export function BarraEstadoPuro({
  ccVisible,
  razonBloqueoCc,
  onAlternarCc,
  tituloCc,
  rama,
  editorMeta,
  onReabrirEncoding,
  onGuardarEncoding,
  onElegirEol,
  usoCuentas
}: PropsBarraEstadoPuro): React.JSX.Element {
  // Mientras haya errores o avisos vivos, el más reciente se muestra como chip; clic los descarta.
  const toasts = useToasts()
  const ultimoProblema = [...toasts].reverse().find((t) => t.tipo === 'error' || t.tipo === 'warn')
  const [menu, setMenu] = useState<MenuAbierto | null>(null)
  const barra = useRef<HTMLElement>(null)
  useEscalonBarra(barra)

  return (
    <footer ref={barra} className="status-bar" aria-label={txLayout().estado.barra}>
      <BloqueIzquierdo rama={rama} ultimoProblema={ultimoProblema} />

      {/* La marca, en el centro exacto de la ventana. No es interactiva (`pointer-events:
          none` en el CSS) para que no parezca un botón ni robe el clic a lo que crece a los lados. */}
      <div className="status-bar-marca" aria-hidden="true">
        <span className="status-bar-marca-texto">Tessera</span>
      </div>

      {/* Bloque derecho: uso de las cuentas del perfil + EOL y codificación del archivo activo
          (solo con un editor de texto activo) + conmutador de la columna del agente, que va
          siempre al final. */}
      <div className="status-bar-right">
        {usoCuentas}
        {editorMeta &&<BotonesArchivo editorMeta={editorMeta} menu={menu} setMenu={setMenu} />}
        <BotonColumnaAgente
          activo={ccVisible}
          alPulsar={onAlternarCc}
          deshabilitado={razonBloqueoCc !== null}
          titulo={
            razonBloqueoCc ??
            tituloCc ??
            (ccVisible ? txLayout().estado.ocultarColumna : txLayout().estado.mostrarColumna)
          }
        />
      </div>

      {menu && editorMeta && (
        <MenuBarraEstado
          ancla={menu.ancla}
          titulo={obtenerTitulosMenuBarraEstado()[menu.paso]}
          elementos={obtenerElementosMenuBarraEstado(menu.paso, editorMeta)}
          onElegir={(id) => elegirEnMenu(menu, id, { onElegirEol, onReabrirEncoding, onGuardarEncoding }, setMenu)}
          onCerrar={() => setMenu(null)}
        />
      )}
    </footer>
  )
}

/**
 * Bloque izquierdo: la rama abre el renglón y luego el problema vivo. Existe aunque esté
 * vacío: la barra es una rejilla de tres columnas y la marca solo queda centrada de verdad
 * si los dos lados son columnas propias (ver `.status-bar` en styles.css).
 */
function BloqueIzquierdo({
  rama,
  ultimoProblema
}: {
  rama?: string | null
  ultimoProblema: Toast | undefined
}): React.JSX.Element {
  const problema = useUltimoValor(ultimoProblema ?? null)
  return (
    <div className="status-bar-left">
      {rama && (
        <span className="status-bar-info" title={txLayout().estado.ramaActual(rama)}>
          <IconoRamaEstado />
          <span className="status-bar-info-text">{rama}</span>
        </span>
      )}
      <Presente como="span" visible={!!ultimoProblema} className="mov-aparece">
      {problema && (
        <button
          className="status-bar-btn status-bar-problem"
          onClick={() => descartarTodos()}
          title={txLayout().estado.tituloProblema(problema.titulo, problema.detalle)}
          aria-label={txLayout().estado.ariaProblema(problema.titulo)}
        >
          <IconoProblemaEstado />
          <span className="status-bar-problem-text">{problema.titulo}</span>
        </button>
      )}
      </Presente>
    </div>
  )
}

/** Botones de fin de línea y de codificación del archivo activo. */
function BotonesArchivo({
  editorMeta,
  menu,
  setMenu
}: {
  editorMeta: EditorMeta
  menu: MenuAbierto | null
  setMenu: SetMenu
}): React.JSX.Element {
  return (
    <>
      <button
        className="status-bar-btn"
        title={txLayout().estado.finDeLinea}
        aria-haspopup="menu"
        aria-expanded={menu?.paso === 'eol'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const ancla = obtenerAnclaBoton(e) // síncrono: currentTarget aún válido
          setMenu((p) => (p?.paso === 'eol' ? null : { paso: 'eol', ancla }))
        }}
      >
        {editorMeta.eol}
      </button>
      <button
        className="status-bar-btn"
        title={txLayout().estado.codificacion}
        aria-haspopup="menu"
        aria-expanded={menu != null && menu.paso !== 'eol'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const ancla = obtenerAnclaBoton(e) // síncrono: currentTarget aún válido
          setMenu((p) => (p && p.paso !== 'eol' ? null : { paso: 'action', ancla }))
        }}
      >
        {etiquetaEncoding(editorMeta.encodingId)}
      </button>
    </>
  )
}

/**
 * Aplica la elección del menú: el paso «action» pasa a la lista de codificaciones (no
 * cierra); los demás ejecutan su acción y cierran.
 */
function elegirEnMenu(
  menu: MenuAbierto,
  id: string,
  acciones: Pick<PropsBarraEstadoPuro, 'onElegirEol' | 'onReabrirEncoding' | 'onGuardarEncoding'>,
  setMenu: SetMenu
): void {
  if (menu.paso === 'eol') {
    acciones.onElegirEol(id as 'CRLF' | 'LF')
    setMenu(null)
  } else if (menu.paso === 'action') {
    setMenu({ paso: id === 'reopen' ? 'reopen' : 'save', ancla: menu.ancla })
  } else if (menu.paso === 'reopen') {
    acciones.onReabrirEncoding(id)
    setMenu(null)
  } else {
    acciones.onGuardarEncoding(id)
    setMenu(null)
  }
}

function obtenerTitulosMenuBarraEstado(): Record<PasoMenuBarraEstado, string> {
  const t = txLayout().estado
  return { eol: t.menuEol, action: t.menuAccion, reopen: t.menuReabrir, save: t.menuGuardar }
}

/** Ítems del menú según el paso. */
function obtenerElementosMenuBarraEstado(paso: PasoMenuBarraEstado, meta: EditorMeta): ElementoMenuBarraEstado[] {
  if (paso === 'eol') {
    return [
      { id: 'LF', etiqueta: 'LF', marcado: meta.eol === 'LF' },
      { id: 'CRLF', etiqueta: 'CRLF', marcado: meta.eol === 'CRLF' }
    ]
  }
  if (paso === 'action') {
    return [
      { id: 'reopen', etiqueta: txLayout().estado.itemReabrir, marcado: false },
      { id: 'save', etiqueta: txLayout().estado.itemGuardar, marcado: false }
    ]
  }
  // reopen / save: la lista completa de codificaciones (la actual marcada).
  return encodingOpciones().map((e) => ({ id: e.id, etiqueta: e.label, marcado: e.id === meta.encodingId }))
}

interface ElementoMenuBarraEstado {
  id: string
  etiqueta: string
  marcado: boolean
}

/** Posición izquierda del menú acotada al viewport tras medir su ancho real. */
function useIzquierdaAcotada(ref: React.RefObject<HTMLDivElement | null>, izquierdaAncla: number): number {
  const [izquierda, setIzquierda] = useState(izquierdaAncla)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.getBoundingClientRect().width
    setIzquierda(Math.max(8, Math.min(izquierdaAncla, window.innerWidth - w - 8)))
  }, [izquierdaAncla, ref])
  return izquierda
}

/** Cierra el menú con un clic fuera o con Escape. */
function useCierreExterno(onCerrar: () => void): void {
  useEffect(() => {
    function alPulsarRaton(): void {
      onCerrar()
    }
    function alPulsarTeclaVentana(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('mousedown', alPulsarRaton)
    window.addEventListener('keydown', alPulsarTeclaVentana)
    return () => {
      window.removeEventListener('mousedown', alPulsarRaton)
      window.removeEventListener('keydown', alPulsarTeclaVentana)
    }
  }, [onCerrar])
}

interface PropsMenuBarraEstado {
  ancla: DOMRect
  titulo: string
  elementos: ElementoMenuBarraEstado[]
  onElegir: (id: string) => void
  onCerrar: () => void
}

/**
 * Popover del selector de la barra de estado: abre hacia arriba desde el botón que lo
 * ancla (la barra vive al fondo), con la altura acotada al espacio disponible y scroll
 * (la lista de codificaciones es larga). El cierre tras elegir lo decide el padre: una
 * acción de dos pasos no cierra en el primero.
 */
function MenuBarraEstado({ ancla, titulo, elementos, onElegir, onCerrar }: PropsMenuBarraEstado): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDespedidaDe(ref, 'flotante')
  const izquierda = useIzquierdaAcotada(ref, ancla.left)
  useCierreExterno(onCerrar)

  // Ancla su borde inferior justo encima del botón; altura tope = hueco hasta arriba.
  const abajo = window.innerHeight - ancla.top + 6
  const altoMaximo = Math.max(120, ancla.top - 16)

  return (
    <div
      ref={ref}
      className="statusbar-menu mov-aparece mov-desde-arriba"
      role="menu"
      style={{ left: izquierda, bottom: abajo, maxHeight: altoMaximo }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="statusbar-menu-title">{titulo}</div>
      <div className="statusbar-menu-list">
        {elementos.map((elemento) => (
          <button
            key={elemento.id}
            className="statusbar-menu-item"
            role="menuitemradio"
            aria-checked={elemento.marcado}
            onClick={() => onElegir(elemento.id)}
          >
            <span className="statusbar-menu-check" aria-hidden="true">
              {elemento.marcado ? '✓' : ''}
            </span>
            {elemento.etiqueta}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Triángulo de aviso para el chip de error persistente de la barra de estado. */
function IconoProblemaEstado(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4l9 15H3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  )
}

/** Icono de rama de git (mismo lenguaje que el de la RielActividadPuro). */
function IconoRamaEstado(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="4.5" x2="6" y2="15" />
      <circle cx="6" cy="18" r="2.6" />
      <circle cx="18" cy="6" r="2.6" />
      <path d="M18 8.6a9 9 0 0 1-9 9" />
    </svg>
  )
}
