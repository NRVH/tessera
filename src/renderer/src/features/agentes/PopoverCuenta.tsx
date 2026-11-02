// =============================================================================
// El selector de cuenta del agente: un popover que cuelga del botón de cuenta de la cabecera, con
// la cuenta del sistema (si el agente puede correr nativo) y sus cuentas de Docker en tarjetas, la
// que usa marcada, y al pasar por una su botón «⋯», con un menú de sus acciones (seguir allí la conversación
// y, en Docker, renombrar, cerrar sesión, eliminar), apartadas de la elección. Al pie, crear otra. Se cierra
// con un clic fuera, con Escape o al elegir.
// Decisiones: docs/decisiones/agentes/modo-por-agente.md, docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import './cuentaAgente.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconoEliminar, IconoRenombrar } from '../../comun/iconosMenu'
import { normalizarErrorIpc } from '../../../../shared/dockerErrors'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { AYUDA, BotonAyuda } from '../academy'
import { turnoEnMarcha } from './agentActivity.ts'
import { useStoreAgentes } from './store'
import { HUECO, MARGEN, recolocar, type PosicionPopover } from '../../comun/popoverFlotante'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { MAX_NOMBRE_CUENTA, type AgentAccount } from '../../../../shared/agent-accounts-ipc'
import { nombreAgente } from './agentPaneTipos'
import { IconoContenedor, IconoElegida, IconoEquipo, IconoMas, IconoMasAcciones, IconoSalir, IconoSeguirAqui } from './iconosAgentPane'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import type { ModoAgente } from './modoAgente'
import { nombreVisible, vistaSelectorCuenta, type FilaCuenta } from './selectorCuenta.ts'
import { txPane } from './textosPane.ts'
import { txTraspaso } from './textosTraspaso.ts'
import { continuarEn } from './continuarEn'
import { esAgenteManual } from '../../../../shared/agentesManuales'
import type { AgentKind } from '../../../../shared/agent-terminal-ipc'
import type { AnclaCuenta } from './useEstadoAgentPane'
import type { ModeloAgentPane } from './useAgentPane'

/** Ancho de los popovers de tarjetas de cuenta. */
export const ANCHO_POPOVER = 288

/**
 * Dónde va un popover de tarjetas: alineado por la derecha bajo su botón y, si no cabe, encima. `dep` vuelve a
 * medirlo cuando cambia su contenido.
 */
export function usePosicionPopover(raiz: React.RefObject<HTMLDivElement>, ancla: AnclaCuenta, dep: number): PosicionPopover {
  const [pos, setPos] = useState<PosicionPopover>({ left: Math.max(MARGEN, ancla.right - ANCHO_POPOVER), top: ancla.bottom + HUECO })
  useLayoutEffect(() => recolocar(raiz.current, (ancho) => ancla.right - ancho, ancla.top, ancla.bottom, setPos), [raiz, ancla.right, ancla.top, ancla.bottom, dep])
  return pos
}

/** Escape cierra el popover y devuelve el foco a la terminal del agente: el que tenía dentro se desmonta con él. */
export function cerrarConEscape(e: React.KeyboardEvent, onCerrar: () => void, m: ModeloAgentPane): void {
  if (e.key !== 'Escape') return
  // Con el menú «⋯» de una tarjeta abierto, Escape es suyo: lo cierra a él y el selector sigue.
  if (e.target instanceof Element && e.target.closest('.ctx-menu')) return
  e.stopPropagation()
  onCerrar()
  m.r.term.current?.focus()
}

export function conMayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/**
 * Cierra con un clic fuera (antes de que llegue a lo de debajo) o con Escape, y pone el foco en la cuenta en
 * uso. Un clic en el diálogo que confirma una acción no cuenta como fuera: el selector sigue abierto detrás
 * para seguir eligiendo o administrando otra.
 */
export function useCierre(raiz: React.RefObject<HTMLDivElement>, onCerrar: () => void): void {
  const cerrar = useRef(onCerrar)
  cerrar.current = onCerrar
  useEffect(() => {
    const fuera = (e: MouseEvent): void => {
      if (raiz.current && e.target instanceof Node && raiz.current.contains(e.target)) return
      if (e.target instanceof Element && e.target.closest('.modal-overlay')) return
      cerrar.current()
    }
    window.addEventListener('mousedown', fuera)
    const tarjeta = (sel: string): HTMLElement | null => raiz.current?.querySelector<HTMLElement>(sel) ?? null
    ;(tarjeta('.cuenta-tarjeta.actual') ?? tarjeta('.cuenta-tarjeta'))?.focus()
    return () => window.removeEventListener('mousedown', fuera)
  }, [raiz])
}

/** Una tarjeta elegible: su icono, nombre y detalle, y la marca si es la que usa. */
export function Tarjeta(p: {
  icono: React.ReactNode
  nombre: string
  detalle: string
  actual: boolean
  onElegir: () => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`cuenta-tarjeta-caja${p.actual ? ' actual' : ''}`}>
      <button
        type="button"
        className={`cuenta-tarjeta${p.actual ? ' actual' : ''}`}
        role="menuitemradio"
        aria-checked={p.actual}
        title={p.nombre}
        onClick={p.onElegir}
      >
        <span className="cuenta-tarjeta-icono">{p.icono}</span>
        <span className="cuenta-tarjeta-texto">
          <span className="cuenta-tarjeta-nombre">{p.nombre}</span>
          <span className="cuenta-tarjeta-detalle">{p.detalle}</span>
        </span>
        {p.actual && (
          <span className="cuenta-tarjeta-marca" aria-label={txPane().menus.enUso}>
            <IconoElegida />
          </span>
        )}
      </button>
      {p.children}
    </div>
  )
}

/**
 * «Continuar esta conversación en <cuenta>» en una cuenta que no es la de ahora (la copia y el pane pasa a esa
 * cuenta reanudándola), como entrada de su menú. Sin conversación abierta sale apagada y dice por qué.
 */
function itemSeguirAqui(donde: string, sesion: string | null, onSeguir: (sesion: string) => void): ContextMenuEntry {
  const t = txTraspaso()
  return {
    label: t.seguirAquiItem(donde),
    icon: <IconoSeguirAqui />,
    disabled: !sesion,
    title: sesion ? t.seguirAqui : t.sinConversacion,
    onClick: () => sesion && onSeguir(sesion)
  }
}

/**
 * El menú de una cuenta, tras su botón «⋯» (que aparece al pasar por la tarjeta o al llegar con el teclado):
 * agrupado por consecuencia, con lo que lleva el trabajo arriba, lo que cambia la cuenta en medio y eliminar al
 * final y aislado. Ningún clic de la tarjeta cae en una acción: hace falta abrir el menú.
 */
function MenuCuenta({ nombre, entradas }: { nombre: string; entradas: ContextMenuEntry[] }): React.JSX.Element | null {
  const boton = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  if (!entradas.some((e) => e !== SEP)) return null
  const abrir = (): void => {
    const r = boton.current?.getBoundingClientRect()
    if (r) setPos({ x: r.left, y: r.bottom + 4 })
  }
  return (
    <>
      <span className={`cuenta-tarjeta-acciones${pos ? ' abierto' : ''}`}>
        <button
          ref={boton}
          type="button"
          className="cuenta-accion"
          title={txPane().menus.masAccionesDe(nombre)}
          aria-label={txPane().menus.masAccionesDe(nombre)}
          aria-haspopup="menu"
          aria-expanded={pos !== null}
          onClick={abrir}
        >
          <IconoMasAcciones />
        </button>
      </span>
      {pos && <ContextMenu x={pos.x} y={pos.y} items={entradas} onClose={() => setPos(null)} disparador={boton} />}
    </>
  )
}

/** Las entradas del menú de una cuenta de Docker: seguir aquí; renombrar y cerrar sesión; eliminar. */
function entradasCuenta(f: FilaCuenta, m: ModeloAgentPane, onRenombrar: () => void, seguir: ContextMenuEntry | null): ContextMenuEntry[] {
  const t = txPane().menus
  // El selector no se cierra: el diálogo de confirmación va encima y, al terminar, se sigue aquí.
  const confirmar = (kind: 'logout' | 'delete'): void => m.ui.setConfirm({ kind, account: f.cuenta })
  const cambiar: ContextMenuEntry[] = []
  if (f.puedeRenombrar) cambiar.push({ label: t.renombrarItem, icon: <IconoRenombrar />, onClick: onRenombrar })
  if (f.puedeCerrarSesion) cambiar.push({ label: t.cerrarSesionItem, icon: <IconoSalir />, onClick: () => confirmar('logout') })
  return [
    ...(seguir ? [seguir, SEP] : []),
    ...cambiar,
    ...(f.puedeEliminar ? [SEP, { label: t.eliminarItem, icon: <IconoEliminar />, danger: true, onClick: () => confirmar('delete') }] : [])
  ]
}

/**
 * La tarjeta de una cuenta mientras se renombra: el nombre es un campo. Enter o salir del campo guardan,
 * Escape deja el que tenía; si el main lo rechaza (vacío, repetido), sigue editándose con el motivo.
 */
function EditorNombre({ f, m, onTerminar }: { f: FilaCuenta; m: ModeloAgentPane; onTerminar: () => void }): React.JSX.Element {
  const t = txPane().menus
  const [valor, setValor] = useState(f.cuenta.nombre)
  const [error, setError] = useState<string | null>(null)
  const guardando = useRef(false)
  // Escape desmonta el campo con el foco dentro y el navegador aún puede mandar su blur: no debe guardar.
  const cancelado = useRef(false)
  const guardar = (): void => {
    if (guardando.current || cancelado.current) return
    if (valor.trim() === f.cuenta.nombre) return onTerminar()
    guardando.current = true
    m.cuenta.handleRenameAccount(f.cuenta.id, valor).then(onTerminar, (err: unknown) => {
      guardando.current = false
      setError(normalizarErrorIpc(err instanceof Error ? err.message : String(err)))
    })
  }
  return (
    <div className={`cuenta-tarjeta-caja${f.actual ? ' actual' : ''}`}>
      <div className={`cuenta-tarjeta editando${f.actual ? ' actual' : ''}`}>
        <span className="cuenta-tarjeta-icono">
          <IconoContenedor />
        </span>
        <span className="cuenta-tarjeta-texto">
          <input
            className="cuenta-tarjeta-campo"
            aria-label={t.nombreCuenta}
            aria-invalid={error !== null}
            value={valor}
            maxLength={MAX_NOMBRE_CUENTA}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setValor(e.target.value)
              setError(null)
            }}
            onBlur={guardar}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                guardar()
              } else if (e.key === 'Escape') {
                // Solo sale de la edición: el selector sigue abierto.
                e.preventDefault()
                e.stopPropagation()
                cancelado.current = true
                onTerminar()
              }
            }}
          />
          {error ? (
            <span className="cuenta-tarjeta-error" role="alert">
              {error}
            </span>
          ) : (
            <span className="cuenta-tarjeta-detalle">{t.dockerDetalle}</span>
          )}
        </span>
      </div>
    </div>
  )
}

/** Elegir una cuenta de Docker: con la del sistema en juego, también es pasar el agente a Docker. */
function eligeDocker(m: ModeloAgentPane, cuenta: AgentAccount): void {
  const { onElegirModo, target } = m.p
  if (onElegirModo) onElegirModo(target.key, 'docker', cuenta.id)
  else m.r.onSelectAccount.current(cuenta.id)
}

/** A dónde se pidió seguir la conversación. */
interface DestinoSeguir {
  donde: string
  modo: ModoAgente
  accountId: string | null
}

/** Pide el traspaso de la conversación de este pane a ese destino. */
function lanzarSeguir(m: ModeloAgentPane, sesion: string, d: DestinoSeguir): void {
  const { target } = m.p
  void continuarEn(target, sesion, { agente: target.agente as AgentKind, modo: d.modo, accountId: d.accountId })
}

/** Solo un agente de serie que elige su modo: de uno manual Tessera no sabe leer ni copiar la conversación. */
function puedeSeguirConversacion(p: ModeloAgentPane['p']): boolean {
  return p.onElegirModo !== undefined && !esAgenteManual(p.target.agente)
}

function Secciones({ m, onCerrar, onConfirmarSeguir }: { m: ModeloAgentPane; onCerrar: () => void; onConfirmarSeguir: (d: DestinoSeguir) => void }): React.JSX.Element {
  const t = txPane().menus
  const { onElegirModo, hostMode, target } = m.p
  const vista = vistaSelectorCuenta(m.s.accounts ?? [], hostMode ? null : m.currentAccount, !onElegirModo ? 'no' : hostMode ? 'actual' : 'disponible')
  const sistema = nombresSistema(window.tessera.plataforma)
  const elegir = (accion: () => void, actual: boolean): void => {
    onCerrar()
    if (!actual) accion()
  }
  const elegirModo = (modo: ModoAgente): void => onElegirModo?.(target.key, modo)
  const [editando, setEditando] = useState<string | null>(null)
  const puedeSeguir = puedeSeguirConversacion(m.p)
  const seguir = (donde: string, modo: ModoAgente, accountId: string | null): ContextMenuEntry | null =>
    puedeSeguir
      ? itemSeguirAqui(donde, m.s.sessionId, (sesion) => {
          const destino = { donde, modo, accountId }
          // Cerrar la sesión para abrirla en otra cuenta le corta el turno en marcha: antes se pregunta.
          if (turnoEnMarcha(useStoreAgentes.getState().activity, target.key)) return onConfirmarSeguir(destino)
          onCerrar()
          lanzarSeguir(m, sesion, destino)
        })
      : null
  const seguirNativa = vista.nativa && !vista.nativa.actual ? seguir(sistema.tuEquipo, 'nativo', null) : null
  const nombreNativa = conMayuscula(sistema.tuEquipo)
  return (
    <>
      {vista.nativa && (
        <section className="cuenta-seccion" aria-label={t.enTuEquipo}>
          <div className="cuenta-seccion-titulo">{t.enTuEquipo}</div>
          <Tarjeta
            icono={<IconoEquipo />}
            nombre={nombreNativa}
            detalle={t.nativaDetalle(sistema.tuEquipo)}
            actual={vista.nativa.actual}
            onElegir={() => elegir(() => elegirModo('nativo'), vista.nativa?.actual === true)}
          >
            {seguirNativa && <MenuCuenta nombre={nombreNativa} entradas={[seguirNativa]} />}
          </Tarjeta>
        </section>
      )}
      <section className="cuenta-seccion" aria-label={vista.nativa ? t.enDocker : t.cuentas}>
        <div className="cuenta-seccion-titulo">{vista.nativa ? t.enDocker : t.cuentas}</div>
        {vista.docker.length === 0 && <p className="cuenta-vacio">{t.sinCuentasDocker}</p>}
        {vista.docker.map((f) => {
          if (editando === f.cuenta.id) return <EditorNombre key={f.cuenta.id} f={f} m={m} onTerminar={() => setEditando(null)} />
          const nombre = nombreVisible(f.cuenta, t.predeterminada)
          return (
            <Tarjeta key={f.cuenta.id} icono={<IconoContenedor />} nombre={nombre} detalle={t.dockerDetalle} actual={f.actual} onElegir={() => elegir(() => eligeDocker(m, f.cuenta), f.actual)}>
              <MenuCuenta nombre={nombre} entradas={entradasCuenta(f, m, () => setEditando(f.cuenta.id), f.actual ? null : seguir(`«${nombre}»`, 'docker', f.cuenta.id))} />
            </Tarjeta>
          )
        })}
      </section>
    </>
  )
}

/** El selector de cuenta, por la capa flotante y alineado por la derecha bajo su botón (encima si no cabe). */
export function PopoverCuenta({ m, ancla, onCerrar }: { m: ModeloAgentPane; ancla: AnclaCuenta; onCerrar: () => void }): React.JSX.Element {
  const raiz = useRef<HTMLDivElement>(null)
  const t = txPane().menus
  useCierre(raiz, onCerrar)
  const [confirmar, setConfirmar] = useState<DestinoSeguir | null>(null)
  const pos = usePosicionPopover(raiz, ancla, m.s.accounts?.length ?? 0)
  const titulo = t.cuentaDe(nombreAgente(m.p.pestanasAgente, m.p.target.agente))
  return (
    <EnCapaFlotante>
      <div
        ref={raiz}
        className="cuenta-pop"
        role="menu"
        aria-label={titulo}
        style={{ left: pos.left, top: pos.top, width: ANCHO_POPOVER }}
        onKeyDown={(e) => {
          if (!confirmar) cerrarConEscape(e, onCerrar, m)
        }}
      >
        <div className="cuenta-pop-cabecera">
          <div className="cuenta-pop-titulo">{titulo}</div>
          <BotonAyuda destino={AYUDA.selectorCuenta} alAbrir={onCerrar} />
        </div>
        <p className="cuenta-pop-ayuda">{t.cuentaDeAyuda(puedeSeguirConversacion(m.p))}</p>
        <Secciones m={m} onCerrar={onCerrar} onConfirmarSeguir={setConfirmar} />
        <button
          type="button"
          className="cuenta-nueva"
          onClick={() => {
            onCerrar()
            m.ui.setAddingAccount(true)
          }}
        >
          <IconoMas />
          {m.p.onElegirModo ? t.nuevaCuentaDocker : t.nuevaCuenta}
        </button>
      </div>
      {confirmar && (
        <ConfirmDialog
          danger
          title={txTraspaso().trabajandoTitulo(nombreAgente(m.p.pestanasAgente, m.p.target.agente))}
          message={txTraspaso().seguirTrabajandoMensaje(nombreAgente(m.p.pestanasAgente, m.p.target.agente), confirmar.donde)}
          confirmLabel={txTraspaso().seguir}
          cancelLabel={txTraspaso().cancelar}
          onConfirm={() => {
            const sesion = m.s.sessionId
            onCerrar()
            if (sesion) lanzarSeguir(m, sesion, confirmar)
          }}
          onCancel={() => setConfirmar(null)}
        />
      )}
    </EnCapaFlotante>
  )
}
