// =============================================================================
// El selector de cuenta del agente: un popover que cuelga del botón de cuenta de la cabecera, con
// la cuenta del sistema (si el agente puede correr nativo) y sus cuentas de Docker en tarjetas, la
// que usa marcada, y al pasar por una de Docker su botón «⋯», con un menú para administrarla (editar su
// configuración, renombrar, cerrar sesión, eliminar), apartado de la elección. Al pie, crear otra y abrir la
// administración de las cuentas de todos los agentes. Se cierra con un clic fuera, con Escape o al elegir.
// Llevarse la conversación a otra cuenta es de `PopoverTraspaso`.
// Decisiones: docs/decisiones/agentes/modo-por-agente.md, docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import './cuentaAgente.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { AYUDA, BotonAyuda } from '../academy'
import { HUECO, MARGEN, recolocar, type PosicionPopover } from '../../comun/popoverFlotante'
import { nombresSistema } from '../../../../shared/nombresSistema'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import { nombreAgente } from './tiposPaneAgente'
import { IconoContenedor, IconoElegida, IconoEquipo, IconoGlobal, IconoMas } from './iconosPaneAgente'
import type { ModoAgente } from './modoAgente'
import { MIN_CUENTAS_COMPACTO, filtrarCuentas, nombreVisible, porDisponibilidad, vistaSelectorCuenta, type FilaCuenta } from './selectorCuenta.ts'
import { txPane } from './textosPane.ts'
import { esAgenteManual } from '../../../../shared/agentesManuales'
import type { AnclaCuenta } from './useEstadoPaneAgente'
import type { ModeloPaneAgente } from './usePaneAgente'
import { MenuCuenta, EditorNombre, entradasCuenta } from './controlesCuenta'
import { abrirGestionAgentes } from './abrirGestion'
import { IconoAjustes } from '../../comun/iconosMenu'

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
export function cerrarConEscape(e: React.KeyboardEvent, onCerrar: () => void, m: ModeloPaneAgente): void {
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

/** Elegir una cuenta de Docker: con la del sistema en juego, también es pasar el agente a Docker. */
function eligeDocker(m: ModeloPaneAgente, cuenta: CuentaAgente): void {
  const { onElegirModo, target } = m.p
  if (onElegirModo) onElegirModo(target.key, 'docker', cuenta.id)
  else m.r.onSeleccionarCuenta.current(cuenta.id)
}

/** Solo un agente de serie que elige su modo: de uno manual Tessera no sabe leer ni copiar la conversación. */
export function puedeSeguirConversacion(p: ModeloPaneAgente['p']): boolean {
  return p.onElegirModo !== undefined && !esAgenteManual(p.target.agente)
}

function Secciones({ m, onCerrar }: { m: ModeloPaneAgente; onCerrar: () => void }): React.JSX.Element {
  const t = txPane().menus
  const { onElegirModo, modoNativo, target: destino } = m.p
  const vista = vistaSelectorCuenta(m.s.cuentasCargadas ?? [], modoNativo ? null : m.cuentaActual, !onElegirModo ? 'no' : modoNativo ? 'actual' : 'disponible')
  const sistema = nombresSistema(window.tessera.plataforma)
  const elegir = (accion: () => void, actual: boolean): void => {
    onCerrar()
    if (!actual) accion()
  }
  const elegirModo = (modo: ModoAgente): void => onElegirModo?.(destino.key, modo)
  const [editando, setEditando] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const compacto = vista.docker.length >= MIN_CUENTAS_COMPACTO
  const hayGlobales = vista.docker.some((f) => f.cuenta.global)
  const { globales, privadas } = porDisponibilidad(compacto ? filtrarCuentas(vista.docker, filtro, t.predeterminada) : vista.docker)
  const tarjetas = (filas: FilaCuenta[]): React.JSX.Element[] =>
    filas.map((f) => {
      if (editando === f.cuenta.id) return <EditorNombre key={f.cuenta.id} f={f} m={{ ...m, perfilId: destino.profileId }} onTerminar={() => setEditando(null)} />
      const nombre = nombreVisible(f.cuenta, t.predeterminada)
      return (
        <Tarjeta key={f.cuenta.id} icono={f.cuenta.global ? <IconoGlobal /> : <IconoContenedor />} nombre={nombre} detalle={f.cuenta.global ? t.globalDetalle : t.dockerDetalle} actual={f.actual} onElegir={() => elegir(() => eligeDocker(m, f.cuenta), f.actual)}>
          <MenuCuenta nombre={nombre} entradas={entradasCuenta(f, { ...m, perfilId: destino.profileId }, () => setEditando(f.cuenta.id), onCerrar)} />
        </Tarjeta>
      )
    })
  const tituloPrivadas = hayGlobales ? t.privadasPerfil : vista.nativa ? t.enDocker : t.cuentas
  return (
    <div className={`cuenta-secciones${compacto ? ' compactas' : ''}`}>
      {compacto && <input className="modal-input cuenta-filtro" placeholder={t.filtrarCuentas} aria-label={t.filtrarCuentas} value={filtro} spellCheck={false} onChange={(e) => setFiltro(e.target.value)} />}
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
      {globales.length > 0 && (
        <section className="cuenta-seccion" aria-label={t.globales}>
          <div className="cuenta-seccion-titulo"><span>{t.globales}</span><span>{globales.length}</span></div>
          <div className="cuenta-seccion-lista">{tarjetas(globales)}</div>
        </section>
      )}
      {(privadas.length > 0 || vista.docker.length === 0) && (
        <section className="cuenta-seccion" aria-label={tituloPrivadas}>
          <div className="cuenta-seccion-titulo"><span>{tituloPrivadas}</span>{hayGlobales && <span>{privadas.length}</span>}</div>
          {vista.docker.length === 0 && <p className="cuenta-vacio">{t.sinCuentasDocker}</p>}
          <div className="cuenta-seccion-lista">{tarjetas(privadas)}</div>
        </section>
      )}
      {vista.docker.length > 0 && globales.length + privadas.length === 0 && <p className="cuenta-vacio">{t.sinCoincidencias}</p>}
    </div>
  )
}

/** El selector de cuenta, por la capa flotante y alineado por la derecha bajo su botón (encima si no cabe). */
export function PopoverCuenta({ m, ancla, onCerrar }: { m: ModeloPaneAgente; ancla: AnclaCuenta; onCerrar: () => void }): React.JSX.Element {
  const raiz = useRef<HTMLDivElement>(null)
  const t = txPane().menus
  useCierre(raiz, onCerrar)
  const pos = usePosicionPopover(raiz, ancla, m.s.cuentasCargadas?.length ?? 0)
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
            m.ui.setAnadiendoCuenta(true)
          }}
        >
          <IconoMas />
          {m.p.onElegirModo ? t.nuevaCuentaDocker : t.nuevaCuenta}
        </button>
        {/* Este selector solo enseña las cuentas de este agente; las de todos, también las de un agente oculto, se
            administran en Configuración. Un agente manual no tiene allí sus cuentas. */}
        {!esAgenteManual(m.p.target.agente) && (
          <button
            type="button"
            className="cuenta-administrar"
            onClick={() => {
              onCerrar()
              abrirGestionAgentes()
            }}
          >
            <IconoAjustes />
            {t.administrarCuentas}
          </button>
        )}
      </div>
    </EnCapaFlotante>
  )
}
