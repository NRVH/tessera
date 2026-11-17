// =============================================================================
// PestanasProyecto (nivel 2): banda de subpestañas de los proyectos abiertos del perfil activo,
// bajo `PestanasPerfil` y con menos peso visual, para que se lea que son hijos del perfil.
// Un proyecto hibernado (por hibernar su perfil) se pinta atenuado. Se reordenan arrastrándolas.
// No dispara el backend: reporta la intención a `usePestanas`. Depende de comun/MenuContextual y DialogoConfirmar.
// Decisiones: docs/decisiones/renderer/reordenar-proyectos-arrastrando.md
// =============================================================================
import { movimientoReducido } from '../../comun/presencia'
import { useEffect, useRef, useState } from 'react'
import { useArrastreProyectos, type ArrastreProyectos } from './useArrastreProyectos'
import { IconoAbrir, IconoCerrar } from '../../comun/iconosMenu'
import type { ProyectoAbiertoDePerfil } from './modeloPestanas'
import type { EstadoPuntoProyecto } from './estadosPunto'
import { MenuContextual } from '../../comun/MenuContextual'
import { DialogoConfirmar } from '../../comun/DialogoConfirmar'
import { reemplazoPideConfirmacion, type ConfirmarReemplazo } from './confirmaciones'
import { txPestanas } from './textos.ts'

interface PropsPestanasProyecto {
  proyectos: ProyectoAbiertoDePerfil[]
  rutaActiva: string | null
  /** false si no hay perfil activo: deshabilita abrir (no hay dónde). */
  hayPerfilActivo: boolean
  /** Nombre del perfil activo, para decir en el botón de abrir dónde queda el proyecto. */
  nombrePerfil: string | null
  onSeleccionarProyecto: (rutaHostProyecto: string) => void
  onCerrarProyecto: (rutaHostProyecto: string) => void
  onAbrirProyecto: () => void
  /**
   * Abre el diálogo nativo y reemplaza ESTE proyecto por el elegido, en su mismo hueco, si
   * `confirmar` lo aprueba (lo pregunta esta banda, ya con la carpeta elegida).
   */
  onReemplazarProyecto: (rutaHostProyecto: string, confirmar: ConfirmarReemplazo) => void
  /** Estado visual del glifo por proyecto (vivo / gris hibernado / spinner al despertar). */
  estadosPunto: Record<string, EstadoPuntoProyecto>
  /**
   * Perfil dueño de estas pestañas. El arrastre lo captura al empezar y no se aplica si al
   * soltar el perfil activo es otro.
   */
  perfilActivoId: string | null
  /** Deja las pestañas de ese perfil en el orden dado (se soltó una sobre otra). */
  onReordenarProyectos: (perfilId: string, rutasOrdenadas: string[]) => void
}

/**
 * Nombre de la pestaña con marquee al hover: el ancho de la pestaña es FIJO, así que un
 * nombre largo se recorta con puntos suspensivos y, si no cabía, se desliza al posar el
 * cursor para leerlo entero. La "x" de cerrar queda siempre en el mismo sitio. La medición
 * (scrollWidth vs clientWidth) se hace al entrar el cursor, sobre el propio DOM.
 */
function NombrePestana({ nombre }: { nombre: string }): React.JSX.Element {
  const interiorRef = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)
  function alEntrar(): void {
    const el = interiorRef.current
    if (!el || movimientoReducido()) return
    // scrollWidth (contenido completo) menos el ancho visible = px que sobran.
    const desborde = el.scrollWidth - el.clientWidth
    setShift(desborde > 1 ? desborde : 0)
  }
  return (
    <span className="project-tab-name" onMouseEnter={alEntrar} onMouseLeave={() => setShift(0)}>
      <span
        ref={interiorRef}
        className={`project-tab-name-inner${shift > 0 ? ' marquee' : ''}`}
        // Duración proporcional a la distancia (~55 px/s) para una lectura pareja.
        style={
          shift > 0
            ? { transform: `translateX(-${shift}px)`, transitionDuration: `${Math.max(0.5, shift / 55)}s` }
            : undefined
        }
      >
        {nombre}
      </span>
    </span>
  )
}

function IconoCerrarPestana(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}

function IconoMasProyecto(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
    </svg>
  )
}

/** Carpeta con `</>`: «un proyecto de código», con el trazo de los demás iconos de la banda. */
function IconoProyecto({ color }: { color: string }): React.JSX.Element {
  return (
    <svg
      className="project-glyph"
      viewBox="0 0 16 16"
      width={13}
      height={13}
      fill="none"
      stroke={color}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.75 4.25v8.25c0 .55.45 1 1 1h10.5c.55 0 1-.45 1-1V6c0-.55-.45-1-1-1H7.9L6.6 3.4c-.2-.25-.5-.4-.8-.4H2.75c-.55 0-1 .45-1 1.25z" />
      <path d="M6.1 7.6 4.9 9.1l1.2 1.5M9.9 7.6l1.2 1.5-1.2 1.5M8.55 7.3l-1.1 3.6" />
    </svg>
  )
}

/**
 * Glifo de un proyecto, con el estado de sesión en el mismo trazo: spinner al despertar, gris si
 * está hibernado. El estado completo vive en el `title` de la pestaña, así que el svg es decorativo.
 */
function GlifoProyecto({ estado }: { estado: EstadoPuntoProyecto }): React.JSX.Element {
  if (estado === 'waking') {
    return <span className="project-dot spinner" title={txPestanas().proyectos.despertando} aria-label={txPestanas().proyectos.despertandoAria} />
  }
  return <IconoProyecto color={estado === 'hibernated' ? 'var(--fg-faint)' : 'var(--fg-muted)'} />
}

/** Solo si hay un estado que contar: un nombre largo ya se lee entero con el desplazamiento al apuntarlo. */
function tituloDePestana(proyecto: ProyectoAbiertoDePerfil): string | undefined {
  const t = txPestanas().proyectos
  if (proyecto.estado === 'hibernated') return t.hibernado(proyecto.nombre)
  return proyecto.estado === 'agente-hibernado' ? `${proyecto.nombre}${t.agenteHibernado}` : undefined
}

interface PropsPestanaProyecto {
  proyecto: ProyectoAbiertoDePerfil
  activa: boolean
  estadoPunto: EstadoPuntoProyecto
  onSeleccionar: () => void
  onMenu: (x: number, y: number) => void
  onPedirCierre: () => void
  arrastre: ArrastreProyectos
  /** ¿Se puede arrastrar? (hay al menos otra pestaña con la que cambiarse el sitio). */
  arrastrable: boolean
}

/**
 * Clase de la pestaña. En reposo es EXACTAMENTE la de siempre: lo del arrastre solo se
 * añade durante el gesto (la que viaja, y la raya del lado donde caerá).
 */
function claseDePestana(proyecto: ProyectoAbiertoDePerfil, activa: boolean, arrastre: ArrastreProyectos): string {
  const ruta = proyecto.rutaHostProyecto
  const base = `project-tab${activa ? ' active' : ''}${proyecto.estado === 'active' ? '' : ' hibernated'}`
  if (arrastre.arrastrada === ruta) return `${base} arrastrando`
  if (arrastre.destino?.ruta === ruta) return `${base} soltar-${arrastre.destino.lado}`
  return base
}

/** Pestaña de un proyecto: su glifo, nombre con marquee y "x" que pide confirmación. */
function PestanaProyecto({
  proyecto,
  activa,
  estadoPunto,
  onSeleccionar,
  onMenu,
  onPedirCierre,
  arrastre,
  arrastrable
}: PropsPestanaProyecto): React.JSX.Element {
  const ruta = proyecto.rutaHostProyecto
  return (
    <div
      role="tab"
      aria-selected={activa}
      className={claseDePestana(proyecto, activa, arrastre)}
      title={tituloDePestana(proyecto)}
      // Sin el atributo cuando no aplica: en reposo, con un solo proyecto, el nodo es el de siempre.
      draggable={arrastrable || undefined}
      onDragStart={(e) => arrastre.alEmpezar(ruta, e)}
      onDragOver={(e) => arrastre.alPasarSobre(ruta, e)}
      onDragLeave={(e) => arrastre.alSalir(ruta, e)}
      onDrop={(e) => arrastre.alSoltar(ruta, e)}
      onDragEnd={arrastre.alTerminar}
      onClick={onSeleccionar}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
    >
      <GlifoProyecto estado={estadoPunto} />
      <NombrePestana nombre={proyecto.nombre} />
      <button
        className="project-tab-close"
        aria-label={txPestanas().proyectos.cerrarAria(proyecto.nombre)}
        title={txPestanas().proyectos.cerrar}
        // La x PIDE confirmación: ni selecciona la pestaña ni cierra de una (doble
        // validación contra el cierre accidental que provocaba el ancho variable).
        onClick={(e) => {
          e.stopPropagation()
          onPedirCierre()
        }}
      >
        <IconoCerrarPestana />
      </button>
    </div>
  )
}

/** Estado vacío: sin proyectos abiertos, con el mismo botón de abrir. */
function SinProyectos({
  hayPerfilActivo,
  onAbrirProyecto
}: {
  hayPerfilActivo: boolean
  onAbrirProyecto: () => void
}): React.JSX.Element {
  return (
    <span className="project-tabs-empty">
      {txPestanas().proyectos.sinProyectos}
      <span className="project-tabs-empty-sep">·</span>
      <button
        className="project-tabs-empty-link"
        onClick={onAbrirProyecto}
        disabled={!hayPerfilActivo}
      >
        {txPestanas().proyectos.abrirEnlace}
      </button>
    </span>
  )
}

function BotonAbrirProyecto({
  hayPerfilActivo,
  nombrePerfil,
  onAbrirProyecto
}: {
  hayPerfilActivo: boolean
  nombrePerfil: string | null
  onAbrirProyecto: () => void
}): React.JSX.Element {
  const etiqueta = txPestanas().proyectos.abrir(nombrePerfil)
  return (
    <button
      className="project-tab-add"
      aria-label={etiqueta}
      title={etiqueta}
      onClick={onAbrirProyecto}
      disabled={!hayPerfilActivo}
    >
      <IconoMasProyecto />
    </button>
  )
}

function ConfirmarCierre({
  proyecto,
  onConfirmar,
  onCancelar
}: {
  proyecto: ProyectoAbiertoDePerfil
  onConfirmar: () => void
  onCancelar: () => void
}): React.JSX.Element {
  const t = txPestanas().proyectos
  return (
    <DialogoConfirmar
      // danger: enfoca "Cancelar", así un Enter reflejo no confirma el cierre.
      peligro
      severidad="advertencia"
      titulo={t.cerrarTitulo(proyecto.nombre)}
      mensaje={t.cerrarMensaje}
      etiquetaConfirmar={t.cerrarConfirmar(proyecto.nombre)}
      etiquetaCancelar={t.cancelar}
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
    />
  )
}

/** Sustitución pendiente de confirmar: el proyecto que se cierra y la carpeta elegida. */
interface ReemplazoPendiente {
  proyecto: ProyectoAbiertoDePerfil
  nueva: { projectHostPath: string; name: string }
}

/** Confirmación de cambiar un proyecto por otra carpeta: cierra el proyecto y su agente, como la ✕. */
function ConfirmarReemplazoDialogo({ pendiente, onRespuesta }: { pendiente: ReemplazoPendiente; onRespuesta: (aprobado: boolean) => void }): React.JSX.Element {
  const t = txPestanas().proyectos
  return (
    <DialogoConfirmar
      // danger: enfoca "Cancelar", así un Enter reflejo no cierra el proyecto.
      peligro
      severidad="advertencia"
      titulo={t.reemplazarTitulo(pendiente.proyecto.nombre)}
      mensaje={t.reemplazarMensaje(pendiente.proyecto.nombre, pendiente.nueva.name)}
      etiquetaConfirmar={t.reemplazar(pendiente.nueva.name)}
      etiquetaCancelar={t.cancelar}
      onConfirmar={() => onRespuesta(true)}
      onCancelar={() => onRespuesta(false)}
    />
  )
}

/**
 * La sustitución que espera respuesta. `pedir` da la pregunta para un proyecto; llega ya con la
 * carpeta elegida, así el diálogo nombra la que se cierra y la que se abre.
 */
function useReemplazoPendiente(): {
  pendiente: ReemplazoPendiente | null
  pedir: (proyecto: ProyectoAbiertoDePerfil) => ConfirmarReemplazo
  responder: (aprobado: boolean) => void
} {
  const [pendiente, setPendiente] = useState<ReemplazoPendiente | null>(null)
  // Quien espera la respuesta: se resuelve siempre, también si otra pregunta ocupa su lugar o la
  // banda se desmonta (sin diálogo no habría quien conteste, y la acción quedaría colgada).
  const esperando = useRef<((aprobado: boolean) => void) | null>(null)
  const soltar = (aprobado: boolean): void => {
    const responder = esperando.current
    esperando.current = null
    responder?.(aprobado)
  }
  useEffect(() => () => soltar(false), [])
  return {
    pendiente,
    pedir: (proyecto) => (nueva) =>
      reemplazoPideConfirmacion(proyecto.rutaHostProyecto, nueva.projectHostPath)
        ? new Promise<boolean>((responder) => {
            soltar(false)
            esperando.current = responder
            setPendiente({ proyecto, nueva })
          })
        : Promise.resolve(true),
    responder: (aprobado) => {
      soltar(aprobado)
      setPendiente(null)
    }
  }
}

interface PropsMenuProyecto {
  x: number
  y: number
  proyecto: ProyectoAbiertoDePerfil
  onCerrar: () => void
  onReemplazar: (proyecto: ProyectoAbiertoDePerfil) => void
  onPedirCierre: (proyecto: ProyectoAbiertoDePerfil) => void
}

/** Menú contextual de un proyecto: abrir otro en su hueco y cerrar. */
function MenuProyecto({ x, y, proyecto, onCerrar, onReemplazar, onPedirCierre }: PropsMenuProyecto): React.JSX.Element {
  const t = txPestanas().proyectos
  return (
    <MenuContextual
      x={x}
      y={y}
      onCerrar={onCerrar}
      items={[
        {
          icon: <IconoAbrir />,
          label: t.abrirAqui(proyecto.nombre),
          onClick: () => onReemplazar(proyecto)
        },
        { icon: <IconoCerrar />, label: t.cerrar, onClick: () => onPedirCierre(proyecto) }
      ]}
    />
  )
}

/** Banda de subpestañas de los proyectos abiertos (nivel 2 de pestañas). */
export function PestanasProyecto(props: PropsPestanasProyecto): React.JSX.Element {
  const { proyectos, rutaActiva, hayPerfilActivo, onAbrirProyecto } = props
  const { onSeleccionarProyecto, onCerrarProyecto, onReemplazarProyecto, estadosPunto } = props
  const arrastre = useArrastreProyectos(proyectos, props.perfilActivoId, props.onReordenarProyectos)
  const arrastrable = proyectos.length > 1 && props.perfilActivoId !== null
  const [menu, setMenu] = useState<{ x: number; y: number; proyecto: ProyectoAbiertoDePerfil } | null>(null)
  // Proyecto pendiente de confirmar cierre: la "x" (o el "Cerrar" del menú) abre el modal
  // en vez de cerrar de una.
  const [cierrePendiente, setCierrePendiente] = useState<ProyectoAbiertoDePerfil | null>(null)
  const reemplazo = useReemplazoPendiente()
  return (
    <div className="tabs-projects" role="tablist" aria-label={txPestanas().proyectos.aria}>
      {proyectos.length === 0 ? (
        <SinProyectos hayPerfilActivo={hayPerfilActivo} onAbrirProyecto={onAbrirProyecto} />
      ) : (
        proyectos.map((proyecto) => (
          <PestanaProyecto
            key={proyecto.rutaHostProyecto}
            proyecto={proyecto}
            activa={proyecto.rutaHostProyecto === rutaActiva}
            estadoPunto={estadosPunto[proyecto.rutaHostProyecto] ?? 'active'}
            onSeleccionar={() => onSeleccionarProyecto(proyecto.rutaHostProyecto)}
            onMenu={(x, y) => setMenu({ x, y, proyecto })}
            onPedirCierre={() => setCierrePendiente(proyecto)}
            arrastre={arrastre}
            arrastrable={arrastrable}
          />
        ))
      )}
      {proyectos.length > 0 && (
        <BotonAbrirProyecto
          hayPerfilActivo={hayPerfilActivo}
          nombrePerfil={props.nombrePerfil}
          onAbrirProyecto={onAbrirProyecto}
        />
      )}

      {menu && (
        <MenuProyecto
          x={menu.x}
          y={menu.y}
          proyecto={menu.proyecto}
          onCerrar={() => setMenu(null)}
          onReemplazar={(proyecto) => onReemplazarProyecto(proyecto.rutaHostProyecto, reemplazo.pedir(proyecto))}
          onPedirCierre={setCierrePendiente}
        />
      )}

      {reemplazo.pendiente && <ConfirmarReemplazoDialogo pendiente={reemplazo.pendiente} onRespuesta={reemplazo.responder} />}

      {cierrePendiente && (
        <ConfirmarCierre
          proyecto={cierrePendiente}
          onConfirmar={() => {
            onCerrarProyecto(cierrePendiente.rutaHostProyecto)
            setCierrePendiente(null)
          }}
          onCancelar={() => setCierrePendiente(null)}
        />
      )}
    </div>
  )
}
