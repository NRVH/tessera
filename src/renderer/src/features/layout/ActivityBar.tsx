// =============================================================================
// ActivityBar: barra de actividad izquierda en dos grupos separados por un filete. Los
// iconos de vista abren la columna lateral (radio: siempre hay una activa) y los de panel
// la franja inferior (toggle). Un icono se arrastra dentro de su grupo o al otro: el grupo
// decide dónde está el botón, no qué abre. Un grupo no puede quedarse vacío.
// Depende de `util/reorderByDrag`, `util/gruposRiel` (la guarda del cruce) y los iconos de `../git` y `../bd`.
// =============================================================================

import { useState } from 'react'
import { reorderByDrag } from '../../util/reorderByDrag'
import { moverEntreGrupos } from '../../util/gruposRiel'
import { IconoCambios, IconoRama } from '../git'
import { IconoBd } from '../bd'

/** Vistas de la columna lateral. */
export type ActivityView = 'files' | 'git' | 'db'

/** Qué panel ocupa la franja inferior, o null si está cerrada. */
export type PanelInferior = 'terminal' | 'gitlog'

/** Ids válidos de cada familia: qué ABRE cada icono, esté en el grupo que esté. */
const VISTAS: ActivityView[] = ['files', 'git', 'db']

/**
 * ¿Es una vista lateral de las que existen hoy? La vista recordada de cada perfil sale de
 * un archivo: con esta guarda un id que ya no existe cae a «Archivos» en vez de pintar el
 * panel equivocado con el riel sin ningún icono marcado.
 */
export function esVistaLateral(v: unknown): v is ActivityView {
  return typeof v === 'string' && (VISTAS as string[]).includes(v)
}
const PANELES_IDS: PanelInferior[] = ['terminal', 'gitlog']
/** Único discriminante: el riel solo tiene dos familias, así que «no es panel» es «es vista». */
function esPanel(id: string): id is PanelInferior {
  return (PANELES_IDS as string[]).includes(id)
}
/** Todos los iconos del riel, en su reparto por defecto. */
const CANONICOS: string[] = [...VISTAS, ...PANELES_IDS]

/** Cuál de los dos grupos: solo para saber de dónde sale y a dónde entra. */
type Grupo = 'arriba' | 'abajo'

/** ¿Las mismas ids en el mismo orden? Evita persistir de más. */
function mismaLista(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

interface ActivityBarProps {
  active: ActivityView
  onSelect: (view: ActivityView) => void
  /**
   * Orden de los íconos de la columna lateral (ids de vista). Lo posee el store del
   * layout (persistido en ajustes); la barra solo lo pinta y notifica reordenamientos.
   */
  order: string[]
  onReorder: (order: string[]) => void
  /** Orden de los conmutadores de la franja inferior. Grupo INDEPENDIENTE. */
  bottomOrder: string[]
  onReorderBottom: (order: string[]) => void
  /**
   * Zona de la ventana que tiene el foco. Separa los dos niveles del resaltado: el icono
   * de la zona donde estás escribiendo se pinta con el color del perfil; el de la que está
   * abierta pero sin foco, en gris.
   */
  zonaEnfocada?: 'lateral' | 'inferior' | null
  /** Panel visible en la franja inferior, o null si está cerrada. */
  panelInferior: PanelInferior | null
  /** Alterna la franja: el mismo panel la cierra; otro la sustituye. */
  onTogglePanelInferior: (panel: PanelInferior) => void
  /**
   * Conteo de cambios del working-tree a pintar sobre el ícono de git. Lo pasa
   * quien monta la barra (única fuente de verdad). null/undefined o 0 => sin badge.
   * Va en el icono de CAMBIOS, no en el del historial.
   */
  gitBadge?: number | null
}

// Glifos de línea: trazo redondeado y coherente.

/** Archivos: una carpeta (dos hojas superpuestas se leen como «copiar», una acción). */
function FilesIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
    </svg>
  )
}

/**
 * Rama de git: el historial (franja inferior). Reutiliza `IconoRama`, el mismo glifo de
 * las filas de ramas de la vista de git; `tamaño={null}` deja que el CSS del riel fije el
 * tamaño, como al resto.
 */
function GitIcon(): React.JSX.Element {
  return <IconoRama tamaño={null} />
}

/** Bases de datos: `IconoBd`, el cilindro que pintan también el árbol de la vista y el montaje del agente. */
function DbIcon(): React.JSX.Element {
  return <IconoBd />
}

/** Terminal: un marco cuadrado con una sola marca, el cursor. */
function TerminalIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M6.4 15.8h6.8" />
    </svg>
  )
}

/** Metadatos de cada vista lateral (icono + etiqueta). El badge lo decide el render. */
const VIEWS: Record<ActivityView, { label: string; icon: () => React.JSX.Element }> = {
  files: { label: 'Archivos', icon: FilesIcon },
  // Dos entradas de git con iconos distintos: el mismo glifo en dos sitios se lee como la misma ventana.
  git: { label: 'Git · Cambios', icon: IconoCambios },
  db: { label: 'Conexiones a bases de datos', icon: DbIcon }
}

/** Metadatos de cada panel inferior. */
const PANELES: Record<PanelInferior, { label: string; icon: () => React.JSX.Element; title: string }> =
  {
    terminal: { label: 'Terminal', icon: TerminalIcon, title: 'Terminal (Ctrl+`)' },
    gitlog: { label: 'Git · Log', icon: GitIcon, title: 'Historial de git' }
  }

/** Resultado de soltar: las dos listas del riel ya resueltas. */
interface ListasRiel {
  arriba: string[]
  abajo: string[]
}

/**
 * Qué listas resultan de soltar `drag` sobre `destino` (sobre `targetId`, o al final si es
 * null), o null si no procede: mismo grupo sin target, orden sin cambio, o un cruce que
 * dejaría vacío el grupo de origen (no se avisa: el icono vuelve a su sitio).
 */
function resolverSoltar(
  drag: { id: string; grupo: Grupo },
  destino: Grupo,
  targetId: string | null,
  arriba: string[],
  abajo: string[]
): ListasRiel | null {
  if (drag.grupo === destino) {
    // Mismo grupo: reordenar. Sin target (el hueco) no hay nada que hacer: `reorderByDrag` es de dos ids.
    if (targetId === null) return null
    const next = reorderByDrag(destino === 'arriba' ? arriba : abajo, drag.id, targetId)
    if (!next) return null
    return destino === 'arriba' ? { arriba: next, abajo } : { arriba, abajo: next }
  }
  const mov = moverEntreGrupos(
    drag.grupo === 'arriba' ? arriba : abajo,
    destino === 'arriba' ? arriba : abajo,
    drag.id,
    targetId
  )
  if (!mov) return null
  return destino === 'arriba' ? { arriba: mov.hasta, abajo: mov.desde } : { arriba: mov.desde, abajo: mov.hasta }
}

type PropsIcono = React.HTMLAttributes<HTMLButtonElement> & { draggable: boolean }

interface ArrastreRiel {
  dragId: string | null
  dragOverId: string | null
  /** Grupo sobre el que se está soltando "al final" (el hueco, no un icono). */
  sobreHueco: Grupo | null
  props: (id: string, grupo: Grupo) => PropsIcono
  propsHueco: (grupo: Grupo) => React.HTMLAttributes<HTMLDivElement>
}

/**
 * Una sola sesión de arrastre para los dos grupos: lleva también de qué grupo viene, que
 * es lo único que hace falta para decidir si el drop reordena o cruza. El id viaja por
 * estado y no por `dataTransfer`, porque `dragOver` no puede leer el payload y haría falta
 * el estado igualmente para saber si el drop es válido.
 */
function useArrastreRiel(
  arriba: string[],
  abajo: string[],
  onCambio: (arriba: string[], abajo: string[]) => void
): ArrastreRiel {
  const [drag, setDrag] = useState<{ id: string; grupo: Grupo } | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [sobreHueco, setSobreHueco] = useState<Grupo | null>(null)

  const limpiar = (): void => {
    setDrag(null)
    setDragOverId(null)
    setSobreHueco(null)
  }

  /** Aplica el drop: reordena si es el mismo grupo, cruza si no. */
  const soltar = (destino: Grupo, targetId: string | null): void => {
    if (!drag) return
    const listas = resolverSoltar(drag, destino, targetId, arriba, abajo)
    if (listas) onCambio(listas.arriba, listas.abajo)
  }

  const props = (id: string, grupo: Grupo): PropsIcono => ({
    draggable: true,
    onDragStart: (e) => {
      setDrag({ id, grupo })
      e.dataTransfer.effectAllowed = 'move'
    },
    // Los tres `stopPropagation` hacen falta: los iconos de abajo viven dentro de la zona de
    // drop de su grupo (`propsHueco`) y los eventos de arrastre burbujean. Sin cortarlos, soltar
    // sobre un icono de abajo aplicaba el movimiento dos veces y el icono acababa siempre el último.
    onDragOver: (e) => {
      if (!drag) return
      e.preventDefault()
      e.stopPropagation()
      if (dragOverId !== id) setDragOverId(id)
      if (sobreHueco !== null) setSobreHueco(null)
    },
    onDragLeave: (e) => {
      e.stopPropagation()
      setDragOverId((prev) => (prev === id ? null : prev))
    },
    onDrop: (e) => {
      e.preventDefault()
      e.stopPropagation()
      soltar(grupo, id)
      limpiar()
    },
    onDragEnd: limpiar
  })

  /** Zona de drop del hueco de cada grupo: soltar ahí manda el icono al final. */
  const propsHueco = (grupo: Grupo): React.HTMLAttributes<HTMLDivElement> => ({
    onDragOver: (e) => {
      if (!drag || drag.grupo === grupo) return
      e.preventDefault()
      if (sobreHueco !== grupo) setSobreHueco(grupo)
      if (dragOverId !== null) setDragOverId(null)
    },
    onDragLeave: () => setSobreHueco((prev) => (prev === grupo ? null : prev)),
    onDrop: (e) => {
      e.preventDefault()
      soltar(grupo, null)
      limpiar()
    }
  })

  return { dragId: drag?.id ?? null, dragOverId, sobreHueco, props, propsHueco }
}

/**
 * Reparte los iconos canónicos en dos grupos que son una partición: cada uno aparece
 * exactamente una vez. Respeta lo guardado, quita repetidos y devuelve a su grupo de
 * origen lo que falte, para que un ajuste corrupto no pueda dejar la barra sin un icono.
 */
function particionarIconos(order: string[], bottomOrder: string[]): { ids: string[]; idsAbajo: string[] } {
  const vistos = new Set<string>()
  const limpiar = (lista: string[]): string[] => {
    const out: string[] = []
    for (const id of lista) {
      if (!CANONICOS.includes(id) || vistos.has(id)) continue
      vistos.add(id)
      out.push(id)
    }
    return out
  }
  const ids = limpiar(order)
  const idsAbajo = limpiar(bottomOrder)
  for (const id of CANONICOS) {
    if (vistos.has(id)) continue
    ;(esPanel(id) ? idsAbajo : ids).push(id)
  }
  return { ids, idsAbajo }
}

/** Clases de un icono del riel: activo, enfocado, sobre el que se suelta y el que se arrastra. */
function claseItem(activo: boolean, enfocado: boolean, id: string, riel: ArrastreRiel): string {
  return (
    `activity-item${activo ? ' active' : ''}` +
    `${enfocado ? ' enfocada' : ''}` +
    `${riel.dragOverId === id ? ' drag-over' : ''}` +
    `${riel.dragId === id ? ' dragging' : ''}`
  )
}

/** Lo que necesita pintar un icono del riel, sea de la familia que sea. */
interface ContextoRiel {
  riel: ArrastreRiel
  active: ActivityView
  onSelect: (view: ActivityView) => void
  zonaEnfocada: 'lateral' | 'inferior' | null
  panelInferior: PanelInferior | null
  onTogglePanelInferior: (panel: PanelInferior) => void
  gitBadge?: number | null
}

/** Icono de un panel inferior: toggle (pulsar el abierto cierra la franja, viva el icono donde viva). */
function pintarPanel(id: PanelInferior, grupo: Grupo, ctx: ContextoRiel): React.JSX.Element {
  const meta = PANELES[id]
  const Icon = meta.icon
  const abierto = ctx.panelInferior === id
  return (
    <button
      key={id}
      className={claseItem(abierto, abierto && ctx.zonaEnfocada === 'inferior', id, ctx.riel)}
      title={meta.title}
      aria-label={meta.label}
      aria-pressed={abierto}
      onClick={() => ctx.onTogglePanelInferior(id)}
      {...ctx.riel.props(id, grupo)}
    >
      <Icon />
    </button>
  )
}

/** El único badge del riel: cambios de git sin confirmar (99+ como tope), o null. */
function badgeDeVista(vista: ActivityView, gitBadge: number | null | undefined): { text: string; aria: string } | null {
  if (vista !== 'git' || gitBadge == null || gitBadge <= 0) return null
  return { text: gitBadge > 99 ? '99+' : String(gitBadge), aria: `${gitBadge} cambios sin confirmar` }
}

/** Icono de una vista lateral: radio (siempre hay exactamente una activa). */
function pintarVista(vista: ActivityView, grupo: Grupo, ctx: ContextoRiel): React.JSX.Element {
  const meta = VIEWS[vista]
  const Icon = meta.icon
  const isActive = ctx.active === vista
  const badge = badgeDeVista(vista, ctx.gitBadge)
  // El badge entra en la etiqueta accesible del botón (su <span> es decorativo): así el
  // lector de pantalla anuncia el conteo.
  const ariaLabel = badge ? `${meta.label}, ${badge.aria}` : meta.label
  return (
    <button
      key={vista}
      // La vista lateral solo lleva el color del perfil si el foco está EN la columna.
      className={claseItem(isActive, isActive && ctx.zonaEnfocada === 'lateral', vista, ctx.riel)}
      title={meta.label}
      aria-label={ariaLabel}
      aria-pressed={isActive}
      onClick={() => ctx.onSelect(vista)}
      {...ctx.riel.props(vista, grupo)}
    >
      <Icon />
      {badge && (
        <span className="activity-badge" aria-hidden="true">
          {badge.text}
        </span>
      )}
    </button>
  )
}

/** Barra de actividad izquierda: vistas laterales arriba, paneles inferiores al pie. */
export function ActivityBar({
  active,
  onSelect,
  order,
  onReorder,
  bottomOrder,
  onReorderBottom,
  zonaEnfocada = null,
  panelInferior,
  onTogglePanelInferior,
  gitBadge
}: ActivityBarProps): React.JSX.Element {
  const { ids, idsAbajo } = particionarIconos(order, bottomOrder)

  // Se avisa solo del grupo que de verdad cambió: `ids` e `idsAbajo` se reconstruyen en cada
  // render, así que devolver el otro tal cual sería una referencia nueva y el efecto que
  // persiste el workspace reescribiría el archivo por un grupo que nadie tocó.
  const riel = useArrastreRiel(ids, idsAbajo, (arribaNuevo, abajoNuevo) => {
    if (!mismaLista(arribaNuevo, ids)) onReorder(arribaNuevo)
    if (!mismaLista(abajoNuevo, idsAbajo)) onReorderBottom(abajoNuevo)
  })
  const ctx: ContextoRiel = {
    riel,
    active,
    onSelect,
    zonaEnfocada,
    panelInferior,
    onTogglePanelInferior,
    gitBadge
  }
  // Lo que decide cómo se comporta un icono es su familia, no el grupo donde vive.
  const pintar = (id: string, grupo: Grupo): React.JSX.Element =>
    esPanel(id) ? pintarPanel(id, grupo, ctx) : pintarVista(id as ActivityView, grupo, ctx)

  return (
    <nav className="activity-bar" aria-label="Barra de actividad">
      <div className="activity-grupo-arriba" role="group" aria-label="Grupo superior del riel">
        {ids.map((id) => pintar(id, 'arriba'))}
      </div>

      {/* El espaciador empuja el segundo grupo al pie y es la zona de drop «al final del
          grupo de arriba». */}
      <div
        className={`activity-spacer${riel.sobreHueco === 'arriba' ? ' drop-zona' : ''}`}
        {...riel.propsHueco('arriba')}
      />
      <div className="activity-sep" role="separator" aria-orientation="horizontal" />
      <div
        className={`activity-grupo-abajo${riel.sobreHueco === 'abajo' ? ' drop-zona' : ''}`}
        role="group"
        aria-label="Grupo inferior del riel"
        {...riel.propsHueco('abajo')}
      >
        {idsAbajo.map((id) => pintar(id, 'abajo'))}
      </div>
    </nav>
  )
}
