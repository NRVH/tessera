// =============================================================================
// SelectorPerfil: el modo minimalista de perfiles. Una pastilla en la barra de título con el
// punto y el nombre del perfil activo; al pulsarla, la lista de perfiles con su ⋯ (el mismo
// menú de la banda) y «Nuevo perfil». El estado es el de la banda (`useBandaPerfiles`), así
// que color, red, hibernar, eliminar, crear y reordenar arrastrando son las mismas piezas
// (`CapasPerfil`, `useArrastrePerfiles`) y el orden de la lista es el de las pestañas.
// Decisiones: docs/decisiones/renderer/banda-de-perfiles.md
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Perfil } from '../../../../main/perfiles/types'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { pegarRecortado } from '../../util/pasteTrim'
import { ladoDeSoltar } from '../../util/reordenarPorArrastre'
import { CapasPerfil } from './CapasPerfil'
import { tintaPerfil } from './colorPerfil'
import { PuntoColorPerfil } from './PuntoColorPerfil'
import type { EstadoPuntoPerfil } from './estadosPunto'
import { txPestanas } from './textos.ts'
import { useBandaPerfiles } from './useBandaPerfiles'

type Banda = ReturnType<typeof useBandaPerfiles>

interface PropsSelectorPerfil {
  perfiles: Perfil[]
  perfilActivoId: string | null
  onSeleccionarPerfil: (perfilId: string) => void
  onAnadirPerfil: (nombre: string, color: string) => void
  onRenombrarPerfil: (perfilId: string, nombre: string) => void
  onCambiarColorPerfil: (perfilId: string, color: string) => void
  onAlternarRedHost: (perfilId: string, redHost: boolean) => void
  onAbrirReglas: (perfilId: string) => void
  onEliminarPerfil: (perfilId: string) => void
  onReordenarPerfiles: (idsOrdenados: string[]) => void
  onHibernarPerfil: (perfilId: string) => void
  estadosPunto: Record<string, EstadoPuntoPerfil>
  atencion?: Set<string>
  working?: Set<string>
  esperando?: Set<string>
}

/** `--profile-color` en línea: el CSS no conoce el color de cada perfil. */
function colorDe(perfil: Perfil): React.CSSProperties {
  return { '--profile-color': tintaPerfil(perfil.color) } as React.CSSProperties
}

/** El punto de un perfil con sus señales; respira mientras el perfil está activo (no hibernado). */
function PuntoPerfil(p: { perfil: Perfil; props: PropsSelectorPerfil }): React.JSX.Element {
  const id = p.perfil.id
  const estado = p.props.estadosPunto[id] ?? 'active'
  return (
    <span className={`selector-perfil-punto${estado === 'active' ? ' respira' : ''}`}>
      <PuntoColorPerfil
        estado={estado}
        color={tintaPerfil(p.perfil.color)}
        working={p.props.working?.has(id) ?? false}
        atencion={p.props.atencion?.has(id) ?? false}
        esperando={p.props.esperando?.has(id) ?? false}
      />
    </span>
  )
}

/** El nombre en edición, en la propia fila: sin banda no hay otra pestaña donde hacerlo. */
function RenombrarEnFila(p: { perfil: Perfil; banda: Banda; props: PropsSelectorPerfil }): React.JSX.Element {
  const { renombrado } = p.banda
  return (
    <span className="selector-perfil-elegir">
      <PuntoPerfil perfil={p.perfil} props={p.props} />
      <input
        className="profile-rename-input"
        autoFocus
        value={renombrado.borrador}
        onChange={(e) => renombrado.setBorrador(e.target.value)}
        onPaste={pegarRecortado(renombrado.setBorrador)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') renombrado.confirmarRenombrado()
          else if (e.key === 'Escape') renombrado.cancelarRenombrado()
        }}
        onBlur={renombrado.confirmarRenombrado}
      />
    </span>
  )
}

/**
 * Clases de una fila: activa, la que se arrastra y, sobre la que se pasa, de qué lado caerá. El
 * lado sale de la misma regla que el soltar (`ladoDeSoltar`), así que la raya no puede mentir.
 */
function claseDeFila(id: string, activo: boolean, banda: Banda, ids: readonly string[]): string {
  const { arrastreId, destinoArrastreId } = banda.arrastre
  const lado = arrastreId && destinoArrastreId === id ? ladoDeSoltar(ids, arrastreId, id) : null
  return (
    `selector-perfil-fila${activo ? ' activa' : ''}` +
    `${arrastreId === id ? ' arrastrando' : ''}` +
    `${lado ? ` soltar-${lado}` : ''}`
  )
}

/**
 * Una fila de la lista: el perfil (o su renombrado en curso) y su ⋯, que abre el menú de la banda.
 * Se arrastra con el mismo estado que las pestañas de la banda: el orden es uno solo.
 */
function FilaPerfil(p: { perfil: Perfil; activo: boolean; banda: Banda; props: PropsSelectorPerfil; onElegir: () => void }): React.JSX.Element {
  const renombrando = p.banda.renombrado.renombrandoId === p.perfil.id
  const { arrastre } = p.banda
  const id = p.perfil.id
  return (
    <div
      className={claseDeFila(id, p.activo, p.banda, p.props.perfiles.map((x) => x.id))}
      style={colorDe(p.perfil)}
      draggable={!renombrando}
      onDragStart={(e) => arrastre.alEmpezar(id, e)}
      onDragOver={(e) => arrastre.alPasarSobre(id, e)}
      onDragLeave={() => arrastre.alSalir(id)}
      onDrop={(e) => arrastre.alSoltar(id, e)}
      onDragEnd={arrastre.alTerminar}
    >
      {renombrando ? (
        <RenombrarEnFila perfil={p.perfil} banda={p.banda} props={p.props} />
      ) : (
        <button type="button" className="selector-perfil-elegir" role="menuitemradio" aria-checked={p.activo} onClick={p.onElegir} title={p.perfil.nombre}>
          <PuntoPerfil perfil={p.perfil} props={p.props} />
          <span className="selector-perfil-nombre">{p.perfil.nombre}</span>
        </button>
      )}
      <button
        type="button"
        className="selector-perfil-mas"
        aria-label={txPestanas().perfil.opcionesDe(p.perfil.nombre)}
        title={txPestanas().perfil.opciones}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          p.banda.setMenu({ x: r.left, y: r.bottom + 2, perfilId: p.perfil.id })
        }}
      >
        <IconoPuntos />
      </button>
    </div>
  )
}

/**
 * Abierta, se cierra con Escape o con un clic fuera (el menú del ⋯ y sus capas cuentan como dentro).
 * El Escape del nombre en edición es solo suyo: cancela el renombrado y la lista sigue abierta.
 */
function useCierreFuera(abierto: boolean, cerrar: () => void, dentro: ReadonlyArray<React.RefObject<HTMLElement>>): void {
  useEffect(() => {
    if (!abierto) return
    const alPulsar = (e: MouseEvent): void => {
      const t = e.target as Element | null
      if (!t || dentro.some((r) => r.current?.contains(t))) return
      if (t.closest('.ctx-menu, .modal-overlay, .profile-create, [class*="selector-color"]')) return
      cerrar()
    }
    const alTeclear = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !(e.target as Element | null)?.closest?.('.profile-rename-input')) cerrar()
    }
    document.addEventListener('mousedown', alPulsar, true)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alPulsar, true)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [abierto, cerrar, dentro])
}

interface PropsLista {
  ancla: { x: number; y: number }
  lista: React.RefObject<HTMLDivElement>
  banda: Banda
  props: PropsSelectorPerfil
  cerrar: () => void
}

/** La lista de perfiles, en la capa flotante: colgando de la barra, el contenido podría pintarle encima. */
function ListaPerfiles({ ancla, lista, banda, props, cerrar }: PropsLista): React.JSX.Element {
  return (
    <EnCapaFlotante>
      <div ref={lista} className="selector-perfil-lista" role="menu" aria-label={txPestanas().perfil.perfiles} style={{ left: ancla.x, top: ancla.y }}>
        {props.perfiles.map((p) => (
          <FilaPerfil
            key={p.id}
            perfil={p}
            activo={p.id === props.perfilActivoId}
            banda={banda}
            props={props}
            onElegir={() => {
              props.onSeleccionarPerfil(p.id)
              cerrar()
            }}
          />
        ))}
        <div className="selector-perfil-sep" role="separator" />
        <button
          type="button"
          className="selector-perfil-nuevo"
          role="menuitem"
          onClick={() => {
            cerrar()
            banda.crear.abrirCreacion()
          }}
        >
          <span className="selector-perfil-mas-signo" aria-hidden="true">
            +
          </span>
          {txPestanas().perfil.nuevo}
        </button>
      </div>
    </EnCapaFlotante>
  )
}

/** Selector de perfil del modo minimalista. */
export function SelectorPerfil(props: PropsSelectorPerfil): React.JSX.Element {
  const banda = useBandaPerfiles(props)
  // Dónde se abre la lista (centrada bajo la pastilla: `x` es su centro), o null si está cerrada.
  const [ancla, setAncla] = useState<{ x: number; y: number } | null>(null)
  const raiz = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  const dentro = useRef([raiz, lista]).current
  const cerrar = useCallback(() => setAncla(null), [])
  // Cerrar la lista desmonta el nombre en edición sin que llegue su `blur`: se guarda aquí.
  const { renombrandoId, confirmarRenombrado } = banda.renombrado
  const cerrarFuera = useCallback(() => {
    if (renombrandoId !== null) confirmarRenombrado()
    cerrar()
  }, [renombrandoId, confirmarRenombrado, cerrar])
  useCierreFuera(ancla !== null, cerrarFuera, dentro)
  const activo = props.perfiles.find((p) => p.id === props.perfilActivoId) ?? null
  return (
    <div className="selector-perfil" ref={raiz}>
      <button
        ref={banda.crear.botonAnadirRef}
        type="button"
        className={`selector-perfil-pastilla${ancla ? ' abierto' : ''}`}
        style={activo ? colorDe(activo) : undefined}
        aria-haspopup="menu"
        aria-expanded={ancla !== null}
        title={txPestanas().perfil.cambiar}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setAncla(ancla ? null : { x: r.left + r.width / 2, y: r.bottom + 4 })
        }}
      >
        {activo && <PuntoPerfil perfil={activo} props={props} />}
        <span className="selector-perfil-nombre">{activo ? activo.nombre : txPestanas().perfil.perfiles}</span>
        <IconoFlecha />
      </button>
      {ancla && <ListaPerfiles ancla={ancla} lista={lista} banda={banda} props={props} cerrar={cerrar} />}
      {/* En la capa flotante: la pastilla se centra con `transform`, que encerraría sus `position: fixed`. */}
      <EnCapaFlotante>
        <CapasPerfil perfiles={props.perfiles} banda={banda} />
      </EnCapaFlotante>
    </div>
  )
}

function IconoFlecha(): React.JSX.Element {
  return (
    <svg className="selector-perfil-flecha" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 4l2.5 2.5L7.5 4" />
    </svg>
  )
}

function IconoPuntos(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </svg>
  )
}
