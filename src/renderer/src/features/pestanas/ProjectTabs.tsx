// =============================================================================
// ProjectTabs (nivel 2): banda de subpestañas de los proyectos abiertos del perfil activo,
// bajo `ProfileTabs` y con menos peso visual, para que se lea que son hijos del perfil.
// Un proyecto hibernado (por hibernar su perfil) se pinta atenuado. Se reordenan arrastrándolas.
// No dispara el backend: reporta la intención a `useTabs`. Depende de comun/ContextMenu y ConfirmDialog.
// Decisiones: docs/decisiones/renderer/reordenar-proyectos-arrastrando.md
// =============================================================================
import { useRef, useState } from 'react'
import { useArrastreProyectos, type ArrastreProyectos } from './useArrastreProyectos'
import { IconoAbrir, IconoCerrar } from '../../comun/iconosMenu'
import type { OpenProject } from './tabsModel'
import type { ProjectDotState } from './profileDotState'
import { ContextMenu } from '../../comun/ContextMenu'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { txPestanas } from './textos.ts'

interface ProjectTabsProps {
  projects: OpenProject[]
  activePath: string | null
  /** false si no hay perfil activo: deshabilita abrir (no hay dónde). */
  hasActiveProfile: boolean
  onSelectProject: (projectHostPath: string) => void
  onCloseProject: (projectHostPath: string) => void
  onOpenProject: () => void
  /** Abre el diálogo nativo y reemplaza ESTE proyecto por el elegido, en su mismo hueco. */
  onReplaceProject: (projectHostPath: string) => void
  /** Estado visual del glifo por proyecto (vivo / gris hibernado / spinner al despertar). */
  dotStates: Record<string, ProjectDotState>
  /**
   * Perfil dueño de estas pestañas. El arrastre lo captura al empezar y no se aplica si al
   * soltar el perfil activo es otro.
   */
  activeProfileId: string | null
  /** Deja las pestañas de ese perfil en el orden dado (se soltó una sobre otra). */
  onReorderProjects: (profileId: string, orderedPaths: string[]) => void
}

/**
 * Nombre de la pestaña con marquee al hover: el ancho de la pestaña es FIJO, así que un
 * nombre largo se recorta con puntos suspensivos y, si no cabía, se desliza al posar el
 * cursor para leerlo entero. La "x" de cerrar queda siempre en el mismo sitio. La medición
 * (scrollWidth vs clientWidth) se hace al entrar el cursor, sobre el propio DOM.
 */
function TabName({ name }: { name: string }): React.JSX.Element {
  const innerRef = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)
  function onEnter(): void {
    const el = innerRef.current
    if (!el) return
    // scrollWidth (contenido completo) menos el ancho visible = px que sobran.
    const overflow = el.scrollWidth - el.clientWidth
    setShift(overflow > 1 ? overflow : 0)
  }
  return (
    <span className="project-tab-name" onMouseEnter={onEnter} onMouseLeave={() => setShift(0)}>
      <span
        ref={innerRef}
        className={`project-tab-name-inner${shift > 0 ? ' marquee' : ''}`}
        // Duración proporcional a la distancia (~55 px/s) para una lectura pareja.
        style={
          shift > 0
            ? { transform: `translateX(-${shift}px)`, transitionDuration: `${Math.max(0.5, shift / 55)}s` }
            : undefined
        }
      >
        {name}
      </span>
    </span>
  )
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon(): React.JSX.Element {
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
function GlifoProyecto({ state }: { state: ProjectDotState }): React.JSX.Element {
  if (state === 'waking') {
    return <span className="project-dot spinner" title={txPestanas().proyectos.despertando} aria-label={txPestanas().proyectos.despertandoAria} />
  }
  return <IconoProyecto color={state === 'hibernated' ? 'var(--fg-faint)' : 'var(--fg-muted)'} />
}

function tituloDePestana(project: OpenProject): string {
  const t = txPestanas().proyectos
  const dormido = project.estado === 'agente-hibernado' ? t.agenteHibernado : ''
  const nombre = project.estado === 'hibernated' ? t.hibernado(project.name) : project.name
  return `${nombre}${dormido}`
}

interface PestanaProyectoProps {
  project: OpenProject
  active: boolean
  dotState: ProjectDotState
  onSelect: () => void
  onMenu: (x: number, y: number) => void
  onCloseRequest: () => void
  arrastre: ArrastreProyectos
  /** ¿Se puede arrastrar? (hay al menos otra pestaña con la que cambiarse el sitio). */
  arrastrable: boolean
}

/**
 * Clase de la pestaña. En reposo es EXACTAMENTE la de siempre: lo del arrastre solo se
 * añade durante el gesto (la que viaja, y la raya del lado donde caerá).
 */
function claseDePestana(project: OpenProject, active: boolean, arrastre: ArrastreProyectos): string {
  const ruta = project.projectHostPath
  const base = `project-tab${active ? ' active' : ''}${project.estado === 'active' ? '' : ' hibernated'}`
  if (arrastre.arrastrada === ruta) return `${base} arrastrando`
  if (arrastre.destino?.ruta === ruta) return `${base} soltar-${arrastre.destino.lado}`
  return base
}

/** Pestaña de un proyecto: su glifo, nombre con marquee y "x" que pide confirmación. */
function PestanaProyecto({
  project,
  active,
  dotState,
  onSelect,
  onMenu,
  onCloseRequest,
  arrastre,
  arrastrable
}: PestanaProyectoProps): React.JSX.Element {
  const ruta = project.projectHostPath
  return (
    <div
      role="tab"
      aria-selected={active}
      className={claseDePestana(project, active, arrastre)}
      title={tituloDePestana(project)}
      // Sin el atributo cuando no aplica: en reposo, con un solo proyecto, el nodo es el de siempre.
      draggable={arrastrable || undefined}
      onDragStart={(e) => arrastre.alEmpezar(ruta, e)}
      onDragOver={(e) => arrastre.alPasarSobre(ruta, e)}
      onDragLeave={(e) => arrastre.alSalir(ruta, e)}
      onDrop={(e) => arrastre.alSoltar(ruta, e)}
      onDragEnd={arrastre.alTerminar}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
    >
      <GlifoProyecto state={dotState} />
      <TabName name={project.name} />
      <button
        className="project-tab-close"
        aria-label={txPestanas().proyectos.cerrarAria(project.name)}
        title={txPestanas().proyectos.cerrar}
        // La x PIDE confirmación: ni selecciona la pestaña ni cierra de una (doble
        // validación contra el cierre accidental que provocaba el ancho variable).
        onClick={(e) => {
          e.stopPropagation()
          onCloseRequest()
        }}
      >
        <CloseIcon />
      </button>
    </div>
  )
}

/** Estado vacío: sin proyectos abiertos, con el mismo botón de abrir. */
function SinProyectos({
  hasActiveProfile,
  onOpenProject
}: {
  hasActiveProfile: boolean
  onOpenProject: () => void
}): React.JSX.Element {
  return (
    <span className="project-tabs-empty">
      {txPestanas().proyectos.sinProyectos}
      <span className="project-tabs-empty-sep">·</span>
      <button
        className="project-tabs-empty-link"
        onClick={onOpenProject}
        disabled={!hasActiveProfile}
      >
        {txPestanas().proyectos.abrirEnlace}
      </button>
    </span>
  )
}

function BotonAbrirProyecto({
  hasActiveProfile,
  onOpenProject
}: {
  hasActiveProfile: boolean
  onOpenProject: () => void
}): React.JSX.Element {
  return (
    <button
      className="project-tab-add"
      aria-label={txPestanas().proyectos.abrir}
      title={txPestanas().proyectos.abrir}
      onClick={onOpenProject}
      disabled={!hasActiveProfile}
    >
      <PlusIcon />
    </button>
  )
}

function ConfirmarCierre({
  project,
  onConfirm,
  onCancel
}: {
  project: OpenProject
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const t = txPestanas().proyectos
  return (
    <ConfirmDialog
      // danger: enfoca "Cancelar", así un Enter reflejo no confirma el cierre.
      danger
      title={t.cerrarTitulo}
      message={t.cerrarMensaje(project.name)}
      confirmLabel={t.cerrar}
      cancelLabel={t.cancelar}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

interface MenuProyectoProps {
  x: number
  y: number
  project: OpenProject
  onClose: () => void
  onReplaceProject: (projectHostPath: string) => void
  onCloseRequest: (project: OpenProject) => void
}

/** Menú contextual de un proyecto: abrir otro en su hueco y cerrar. */
function MenuProyecto({ x, y, project, onClose, onReplaceProject, onCloseRequest }: MenuProyectoProps): React.JSX.Element {
  const t = txPestanas().proyectos
  return (
    <ContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={[
        {
          icon: <IconoAbrir />,
          label: t.abrirAqui,
          onClick: () => onReplaceProject(project.projectHostPath)
        },
        { icon: <IconoCerrar />, label: t.cerrar, onClick: () => onCloseRequest(project) }
      ]}
    />
  )
}

/** Banda de subpestañas de los proyectos abiertos (nivel 2 de pestañas). */
export function ProjectTabs(props: ProjectTabsProps): React.JSX.Element {
  const { projects, activePath, hasActiveProfile, onOpenProject } = props
  const { onSelectProject, onCloseProject, onReplaceProject, dotStates } = props
  const arrastre = useArrastreProyectos(projects, props.activeProfileId, props.onReorderProjects)
  const arrastrable = projects.length > 1 && props.activeProfileId !== null
  const [menu, setMenu] = useState<{ x: number; y: number; project: OpenProject } | null>(null)
  // Proyecto pendiente de confirmar cierre: la "x" (o el "Cerrar" del menú) abre el modal
  // en vez de cerrar de una.
  const [closing, setClosing] = useState<OpenProject | null>(null)
  return (
    <div className="tabs-projects" role="tablist" aria-label={txPestanas().proyectos.aria}>
      {projects.length === 0 ? (
        <SinProyectos hasActiveProfile={hasActiveProfile} onOpenProject={onOpenProject} />
      ) : (
        projects.map((project) => (
          <PestanaProyecto
            key={project.projectHostPath}
            project={project}
            active={project.projectHostPath === activePath}
            dotState={dotStates[project.projectHostPath] ?? 'active'}
            onSelect={() => onSelectProject(project.projectHostPath)}
            onMenu={(x, y) => setMenu({ x, y, project })}
            onCloseRequest={() => setClosing(project)}
            arrastre={arrastre}
            arrastrable={arrastrable}
          />
        ))
      )}
      {projects.length > 0 && (
        <BotonAbrirProyecto hasActiveProfile={hasActiveProfile} onOpenProject={onOpenProject} />
      )}

      {menu && (
        <MenuProyecto
          x={menu.x}
          y={menu.y}
          project={menu.project}
          onClose={() => setMenu(null)}
          onReplaceProject={onReplaceProject}
          onCloseRequest={setClosing}
        />
      )}

      {closing && (
        <ConfirmarCierre
          project={closing}
          onConfirm={() => {
            onCloseProject(closing.projectHostPath)
            setClosing(null)
          }}
          onCancel={() => setClosing(null)}
        />
      )}
    </div>
  )
}
