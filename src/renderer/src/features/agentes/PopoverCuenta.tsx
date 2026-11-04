// =============================================================================
// El selector de cuenta del agente: un popover que cuelga del botón de cuenta de la cabecera, con
// la cuenta del sistema (si el agente puede correr nativo) y sus cuentas de Docker en tarjetas, la
// que usa marcada, y al pasar por una de Docker su botón «⋯», con un menú para administrarla (renombrar, cerrar
// sesión, eliminar), apartado de la elección. Al pie, crear otra. Se cierra con un clic fuera, con Escape o al elegir.
// Llevarse la conversación a otra cuenta es de `PopoverTraspaso`.
// Decisiones: docs/decisiones/agentes/modo-por-agente.md, docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import './cuentaAgente.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconoEliminar, IconoRenombrar } from '../../comun/iconosMenu'
import { normalizarErrorIpc } from '../../../../shared/dockerErrors'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { AYUDA, BotonAyuda } from '../academy'
import { HUECO, MARGEN, recolocar, type PosicionPopover } from '../../comun/popoverFlotante'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { MAX_NOMBRE_CUENTA, type AgentAccount } from '../../../../shared/agent-accounts-ipc'
import { nombreAgente } from './agentPaneTipos'
import { IconoContenedor, IconoElegida, IconoEquipo, IconoMas, IconoMasAcciones, IconoSalir } from './iconosAgentPane'
import { ContextMenu, SEP, type ContextMenuEntry } from '../../comun/ContextMenu'
import type { ModoAgente } from './modoAgente'
import { nombreVisible, vistaSelectorCuenta, type FilaCuenta } from './selectorCuenta.ts'
import { txPane } from './textosPane.ts'
import { esAgenteManual } from '../../../../shared/agentesManuales'
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
    // Sin tarjetas todavía, el foco va al popover: fuera de él, Escape no lo cerraría.
    ;(tarjeta('.cuenta-tarjeta.actual') ?? tarjeta('.cuenta-tarjeta') ?? raiz.current)?.focus()
    return () => window.removeEventListener('mousedown', fuera)
  }, [raiz])
}

/** Una tarjeta elegible: su icono, nombre y detalle (si lo lleva), y la marca si es la que usa. */
export function Tarjeta(p: {
  icono: React.ReactNode
  nombre: string
  detalle?: string
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
          {p.detalle && <span className="cuenta-tarjeta-detalle">{p.detalle}</span>}
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
 * El menú de una cuenta, tras su botón «⋯» (que aparece al pasar por la tarjeta o al llegar con el teclado):
 * agrupado por consecuencia, con eliminar al final y aislado. Ningún clic de la tarjeta cae en una acción: hace
 * falta abrir el menú.
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

/** Las entradas del menú de una cuenta de Docker: renombrar y cerrar sesión; eliminar. */
function entradasCuenta(f: FilaCuenta, m: ModeloAgentPane, onRenombrar: () => void): ContextMenuEntry[] {
  const t = txPane().menus
  // El selector no se cierra: el diálogo de confirmación va encima y, al terminar, se sigue aquí.
  const confirmar = (kind: 'logout' | 'delete'): void => m.ui.setConfirm({ kind, account: f.cuenta })
  const cambiar: ContextMenuEntry[] = []
  if (f.puedeRenombrar) cambiar.push({ label: t.renombrarItem, icon: <IconoRenombrar />, onClick: onRenombrar })
  if (f.puedeCerrarSesion) cambiar.push({ label: t.cerrarSesionItem, icon: <IconoSalir />, onClick: () => confirmar('logout') })
  return [
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

/** Solo un agente de serie que elige su modo: de uno manual Tessera no sabe leer ni copiar la conversación. */
export function puedeSeguirConversacion(p: ModeloAgentPane['p']): boolean {
  return p.onElegirModo !== undefined && !esAgenteManual(p.target.agente)
}

function Secciones({ m, onCerrar }: { m: ModeloAgentPane; onCerrar: () => void }): React.JSX.Element {
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
  return (
    <>
      {vista.nativa && (
        <section className="cuenta-seccion" aria-label={t.enTuEquipo}>
          <div className="cuenta-seccion-titulo">{t.enTuEquipo}</div>
          <Tarjeta
            icono={<IconoEquipo />}
            nombre={conMayuscula(sistema.tuEquipo)}
            detalle={t.nativaDetalle(sistema.tuEquipo)}
            actual={vista.nativa.actual}
            onElegir={() => elegir(() => elegirModo('nativo'), vista.nativa?.actual === true)}
          />
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
              <MenuCuenta nombre={nombre} entradas={entradasCuenta(f, m, () => setEditando(f.cuenta.id))} />
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
  const pos = usePosicionPopover(raiz, ancla, m.s.accounts?.length ?? 0)
  const titulo = t.cuentaDe(nombreAgente(m.p.pestanasAgente, m.p.target.agente))
  return (
    <EnCapaFlotante>
      <div
        ref={raiz}
        className="cuenta-pop"
        role="menu"
        tabIndex={-1}
        aria-label={titulo}
        style={{ left: pos.left, top: pos.top, width: ANCHO_POPOVER }}
        onKeyDown={(e) => cerrarConEscape(e, onCerrar, m)}
      >
        <div className="cuenta-pop-cabecera">
          <div className="cuenta-pop-titulo">{titulo}</div>
          <BotonAyuda destino={AYUDA.selectorCuenta} alAbrir={onCerrar} />
        </div>
        <p className="cuenta-pop-ayuda">{t.cuentaDeAyuda(puedeSeguirConversacion(m.p))}</p>
        <Secciones m={m} onCerrar={onCerrar} />
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
    </EnCapaFlotante>
  )
}
