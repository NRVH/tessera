// =============================================================================
// Tira de pestañas de la columna central: primer hijo de `.editor-area`, sin botón «+».
// El estado sucio y el de borrado llegan como Sets de ids desde App; ensucian archivos y los
// diffs editables del working tree, que comparten buffer con la pestaña del archivo.
// El menú contextual cierra por lotes (derecha, izquierda, todo), revela y guarda sin título.
// A la derecha, fijas: la flecha con las pestañas que no se ven y el hueco de acciones del pane.
// =============================================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconoAbrirFuera,
  IconoCerrarDerecha,
  IconoCerrarIzquierda,
  IconoCerrarTodo,
  IconoGuardar
} from '../../comun/iconosMenu'
import { notifyError } from '../../comun/notifications'
import type { EditorTab } from './editorTabsModel'
import type { CenterPane } from './centerPane'
import { esRutaVirtual } from '../../../../shared/jarPath'
import { statusClass } from '../git'
import { FileTypeIcon } from '../../comun/fileIcons'
import { ContextMenu, SEP } from '../../comun/ContextMenu'

interface EditorTabsProps {
  tabs: EditorTab[]
  activeId: string | null
  /** Ids de tabs sucias (solo kind==='file'); las provee App desde su Set. */
  dirtyIds: Set<string>
  /** Ids de tabs cuyo archivo ya no existe en disco: el nombre se tacha y Ctrl+S lo recrea. */
  borradoIds: Set<string>
  /** Letra de status git por tab.id (solo archivos); colorea el nombre y convive con el dot. */
  gitStatusById: Map<string, string>
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  /** Guarda la pestaña `id` (menú contextual); hoy solo se ofrece en las sin título. */
  onSaveTab: (id: string) => void
  /** Recibe el hueco de acciones de la derecha, donde el pane visible pinta las suyas. */
  slotAccionesRef?: (el: HTMLElement | null) => void
}

/** Las dos flechas de comparar, en el sitio del icono de tipo. `aria-label` dice que es un diff. */
function IconoDiff(): React.JSX.Element {
  return (
    <span className="editor-tab-icon editor-tab-kind" role="img" aria-label="Diferencias">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 4.5h11M10 2l2.5 2.5L10 7" />
        <path d="M14.5 11.5h-11M6 9l-2.5 2.5L6 14" />
      </svg>
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

/** Basename POSIX de una ruta relativa (las rutas del editor son siempre POSIX). */
function basename(path: string): string {
  return path.split('/').pop() ?? path
}

/** Etiqueta a mostrar en la pestaña: nombre del archivo, o basename del diff. */
function tabLabel(pane: CenterPane): string {
  if (pane.kind === 'file') return pane.file.name
  if (pane.kind === 'untitled') return pane.untitled.name
  return basename(pane.target.path)
}

/** Nombre con el que se resuelve el icono de tipo: el mismo dato del que sale la etiqueta. */
function tabIconName(pane: CenterPane): string {
  if (pane.kind === 'file') return pane.file.name
  if (pane.kind === 'untitled') return pane.untitled.name
  return basename(pane.target.path)
}

/** Tooltip completo: la ruta; para diff se marca explícitamente como tal. */
function tabTooltip(pane: CenterPane): string {
  if (pane.kind === 'file') return pane.file.path
  if (pane.kind === 'untitled') {
    return pane.untitled.saved
      ? `${pane.untitled.name} (fuera del proyecto)`
      : `${pane.untitled.name} (sin guardar)`
  }
  return `${pane.target.path} (diff)`
}

interface PestanaProps {
  tab: EditorTab
  active: boolean
  dirty: boolean
  borrado: boolean
  gitLetter: string | undefined
  onSelect: () => void
  onClose: () => void
  onMenu: (e: React.MouseEvent) => void
}

function Pestana({
  tab,
  active,
  dirty,
  borrado,
  gitLetter,
  onSelect,
  onClose,
  onMenu
}: PestanaProps): React.JSX.Element {
  const isDiff = tab.pane.kind === 'diff'
  const label = tabLabel(tab.pane)
  // Contenido de dentro de un .jar: se tinta igual que sus filas en el árbol (misma regla).
  const enArchivo = tab.pane.kind === 'file' && esRutaVirtual(tab.pane.file.path)
  return (
    <div
      role="tab"
      aria-selected={active}
      data-tab-id={tab.id}
      className={`editor-tab${active ? ' active' : ''}${dirty ? ' dirty' : ''}${
        borrado ? ' borrado' : ''
      }${enArchivo ? ' in-archive' : ''}${tab.efimera ? ' efimera' : ''}`}
      // Los sufijos van aquí y no en `tabTooltip`, que solo ve el pane y no el flag ni el borrado.
      title={`${tabTooltip(tab.pane)}${borrado ? ' · el archivo ya no existe en disco; Ctrl+S vuelve a crearlo' : ''}${tab.efimera ? ' · vista previa (se reemplaza al abrir otro diff del historial)' : ''}`}
      onClick={onSelect}
      onContextMenu={onMenu}
    >
      {/* Un icono en todas las pestañas: una tira con glifo solo en algunas se lee peor. El de un
          diff son las dos flechas de comparar, en lugar del tipo: distingue el diff del archivo homónimo. */}
      {isDiff ? <IconoDiff /> : <FileTypeIcon name={tabIconName(tab.pane)} className="editor-tab-icon" />}
      <span className={`editor-tab-name${gitLetter ? ` ${statusClass(gitLetter)}` : ''}`}>
        {label}
      </span>
      {/* Slot de ancho fijo: dot (reposo, si dirty) <-> x (hover/cierre). */}
      <span className="editor-tab-slot">
        {/* El punto sale también sin cambios pendientes cuando el archivo desapareció. */}
        {(dirty || borrado) && <span className="editor-tab-dot" aria-hidden="true" />}
        <button
          className="editor-tab-close"
          aria-label={`Cerrar ${label}`}
          title="Cerrar"
          // stopPropagation: la x cierra, NO selecciona la pestaña.
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          <CloseIcon />
        </button>
      </span>
    </div>
  )
}

/** Ítems del menú contextual de la pestaña `index`; `closeIds` cierra por lotes. */
function itemsMenuPestana(
  tabs: EditorTab[],
  index: number,
  closeIds: (ids: string[]) => void,
  onSaveTab: (id: string) => void
): React.ComponentProps<typeof ContextMenu>['items'] {
  const kind = tabs[index]?.pane.kind
  return [
    // Solo en archivos: un sin título aún no existe en disco y un diff puede comparar
    // revisiones que no están, así que el explorador no tendría qué seleccionar.
    ...(kind === 'file'
      ? [
          {
            icon: <IconoAbrirFuera />,
            label: 'Abrir en el explorador',
            onClick: () => {
              const pane = tabs[index]?.pane
              if (pane?.kind !== 'file') return
              void window.tessera.files
                .reveal(pane.file.path)
                .catch((err: unknown) => notifyError('No se pudo abrir el explorador', err))
            }
          },
          SEP
        ]
      : []),
    // «Guardar como…» solo en las sin título: las de archivo ya tienen su Ctrl+S.
    ...(kind === 'untitled'
      ? [
          {
            icon: <IconoGuardar />,
            label: 'Guardar como…',
            onClick: () => onSaveTab(tabs[index].id)
          },
          SEP
        ]
      : []),
    {
      icon: <IconoCerrarDerecha />,
      label: 'Cerrar los de la derecha',
      // Habilitada solo si hay pestañas DESPUÉS de la clicada.
      disabled: index >= tabs.length - 1,
      onClick: () => closeIds(tabs.slice(index + 1).map((t) => t.id))
    },
    {
      icon: <IconoCerrarIzquierda />,
      label: 'Cerrar los de la izquierda',
      // Habilitada solo si hay pestañas ANTES de la clicada.
      disabled: index <= 0,
      onClick: () => closeIds(tabs.slice(0, index).map((t) => t.id))
    },
    // «Cerrar todo» tiene el mayor alcance: separado, para no pulsarlo por inercia.
    SEP,
    {
      icon: <IconoCerrarTodo />,
      label: 'Cerrar todo',
      // Con una sola pestaña, las tres quedan inertes.
      disabled: tabs.length <= 1,
      onClick: () => closeIds(tabs.map((t) => t.id))
    }
  ]
}

/** Los elementos de las pestañas, en el orden de la lista (sus hijos son las pestañas). */
function elementosDe(lista: HTMLElement): HTMLElement[] {
  return Array.from(lista.children) as HTMLElement[]
}

/**
 * Las pestañas que no se ven enteras en la lista, en orden. Con cajas y no con `offsetLeft`:
 * con un zoom fraccionario los enteros redondean y una pestaña al borde contaría mal.
 */
function pestanasOcultas(lista: HTMLElement, tabs: EditorTab[]): EditorTab[] {
  const caja = lista.getBoundingClientRect()
  const els = elementosDe(lista)
  return tabs.filter((_, i) => {
    const r = els[i]?.getBoundingClientRect()
    return r !== undefined && (r.left < caja.left - 0.5 || r.right > caja.right + 0.5)
  })
}

/**
 * Si las pestañas desbordan la lista. Se mide tras cada render (dos lecturas): el ancho del
 * contenido cambia también sin que cambie el número de pestañas (un nombre más largo, el punto
 * de sucio), y un observador de tamaño solo ve la caja de la lista.
 */
function useDesborde(listaRef: React.RefObject<HTMLDivElement>): boolean {
  const [desborda, setDesborda] = useState(false)
  useLayoutEffect(() => {
    const lista = listaRef.current
    if (!lista) return
    const medir = (): void => setDesborda(lista.scrollWidth > lista.clientWidth + 1)
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(lista)
    return () => observador.disconnect()
  })
  return desborda
}

/**
 * La pestaña activa a la vista dentro de la tira. Se mueve la lista a mano: `scrollIntoView`
 * desplazaría también los antepasados con `overflow: hidden` (la tarjeta, el marco) y
 * descolocaría la ventana sin forma de volver. Corre al cambiar la activa o las pestañas
 * (otro proyecto puede tener activa una pestaña con el mismo id).
 */
function useActivaALaVista(listaRef: React.RefObject<HTMLDivElement>, activeId: string | null, tabs: EditorTab[]): void {
  useLayoutEffect(() => {
    const lista = listaRef.current
    const i = tabs.findIndex((t) => t.id === activeId)
    const el = i < 0 || !lista ? undefined : elementosDe(lista)[i]
    if (!lista || !el) return
    const izquierda = el.offsetLeft
    const derecha = izquierda + el.offsetWidth
    if (izquierda < lista.scrollLeft) lista.scrollLeft = izquierda
    else if (derecha > lista.scrollLeft + lista.clientWidth) lista.scrollLeft = derecha - lista.clientWidth
  }, [listaRef, activeId, tabs])
}

type MenuDesborde = { x: number; y: number; ocultas: EditorTab[] } | null

/** El menú de la flecha: es una foto de las ocultas, así que se cierra si las pestañas cambian. */
function useMenuDesborde(tabs: EditorTab[]): [MenuDesborde, (m: MenuDesborde) => void] {
  const [menu, setMenu] = useState<MenuDesborde>(null)
  useEffect(() => setMenu(null), [tabs])
  return [menu, setMenu]
}

function ChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4.5 6.5L8 10l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Ítems del menú de la flecha: las pestañas ocultas, con su icono; elegir una la activa. */
function itemsDesborde(ocultas: EditorTab[], onSelectTab: (id: string) => void): React.ComponentProps<typeof ContextMenu>['items'] {
  return ocultas.map((tab) => ({
    icon: tab.pane.kind === 'diff' ? <IconoDiff /> : <FileTypeIcon name={tabIconName(tab.pane)} className="editor-tab-icon" />,
    label: tabLabel(tab.pane),
    onClick: () => onSelectTab(tab.id)
  }))
}

/** Tira de pestañas del editor con su menú contextual, la flecha de desborde y el hueco de acciones. */
export function EditorTabs(props: EditorTabsProps): React.JSX.Element {
  const { tabs, activeId, onSelectTab, onCloseTab, onSaveTab } = props
  // Menú contextual: posición + índice de la pestaña sobre la que se abrió.
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [desborde, setDesborde] = useMenuDesborde(tabs)
  const listaRef = useRef<HTMLDivElement>(null)
  const desborda = useDesborde(listaRef)
  useActivaALaVista(listaRef, activeId, tabs)

  /** Cierra una lista de ids (batch): cada onCloseTab compone su updater funcional. */
  function closeIds(ids: string[]): void {
    for (const id of ids) onCloseTab(id)
  }

  function abrirDesborde(e: React.MouseEvent<HTMLButtonElement>): void {
    const lista = listaRef.current
    if (!lista) return
    const caja = e.currentTarget.getBoundingClientRect()
    const ocultas = pestanasOcultas(lista, tabs)
    if (ocultas.length > 0) setDesborde({ x: caja.left, y: caja.bottom + 2, ocultas })
  }

  return (
    <div className="editor-tabs con-acciones">
      <div
        ref={listaRef}
        className="editor-tabs-lista"
        role="tablist"
        aria-label="Archivos abiertos"
        // Sin barra visible: la rueda vertical desplaza la tira en horizontal.
        onWheel={(e) => {
          if (e.deltaX === 0 && listaRef.current) listaRef.current.scrollLeft += e.deltaY
        }}
      >
        {tabs.map((tab, index) => (
          <Pestana
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            dirty={props.dirtyIds.has(tab.id)}
            borrado={props.borradoIds.has(tab.id)}
            // Los diffs quedan fuera por la clave: su id (`diff:WORKTREE:<ruta>`) no casa con una ruta.
            gitLetter={tab.pane.kind === 'diff' ? undefined : props.gitStatusById.get(tab.id)}
            onSelect={() => onSelectTab(tab.id)}
            onClose={() => onCloseTab(tab.id)}
            onMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, index })
            }}
          />
        ))}
      </div>
      <div className="editor-tabs-acciones">
        {desborda && (
          <button type="button" className="btn btn-icon editor-tabs-desborde" title="Pestañas que no se ven" aria-label="Pestañas que no se ven" onClick={abrirDesborde}>
            <ChevronIcon />
          </button>
        )}
        <div ref={props.slotAccionesRef} className="editor-tabs-slot" />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={itemsMenuPestana(tabs, menu.index, closeIds, onSaveTab)} onClose={() => setMenu(null)} />}
      {desborde && (
        <ContextMenu x={desborde.x} y={desborde.y} items={itemsDesborde(desborde.ocultas, onSelectTab)} onClose={() => setDesborde(null)} />
      )}
    </div>
  )
}
