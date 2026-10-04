// =============================================================================
// Tira de pestañas de la columna central: primer hijo de `.editor-area`, sin botón «+».
// El estado sucio y el de borrado llegan como Sets de ids desde App; ensucian archivos y los
// diffs editables del working tree, que comparten buffer con la pestaña del archivo.
// El menú contextual cierra por lotes (derecha, izquierda, todo), revela y guarda sin título.
// =============================================================================

import { useState } from 'react'
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
      className={`editor-tab${active ? ' active' : ''}${dirty ? ' dirty' : ''}${
        borrado ? ' borrado' : ''
      }${enArchivo ? ' in-archive' : ''}${tab.efimera ? ' efimera' : ''}`}
      // Los sufijos van aquí y no en `tabTooltip`, que solo ve el pane y no el flag ni el borrado.
      title={`${tabTooltip(tab.pane)}${borrado ? ' · el archivo ya no existe en disco; Ctrl+S vuelve a crearlo' : ''}${tab.efimera ? ' · vista previa (se reemplaza al abrir otro diff del historial)' : ''}`}
      onClick={onSelect}
      onContextMenu={onMenu}
    >
      {/* Icono de tipo en todas las pestañas: una tira con glifo solo en algunas se lee peor.
          La insignia «diff» dice qué vista del archivo se mira. */}
      <FileTypeIcon name={tabIconName(tab.pane)} className="editor-tab-icon" />
      {isDiff && <span className="editor-tab-kind">diff</span>}
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

/** Tira de pestañas del editor con su menú contextual. */
export function EditorTabs({
  tabs,
  activeId,
  dirtyIds,
  borradoIds,
  gitStatusById,
  onSelectTab,
  onCloseTab,
  onSaveTab
}: EditorTabsProps): React.JSX.Element {
  // Menú contextual: posición + índice de la pestaña sobre la que se abrió.
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null)

  /** Cierra una lista de ids (batch): cada onCloseTab compone su updater funcional. */
  function closeIds(ids: string[]): void {
    for (const id of ids) onCloseTab(id)
  }

  return (
    <div className="editor-tabs" role="tablist" aria-label="Archivos abiertos">
      {tabs.map((tab, index) => (
        <Pestana
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          dirty={dirtyIds.has(tab.id)}
          borrado={borradoIds.has(tab.id)}
          // Los diffs quedan fuera por la clave: su id (`diff:WORKTREE:<ruta>`) no casa con una ruta.
          gitLetter={tab.pane.kind === 'diff' ? undefined : gitStatusById.get(tab.id)}
          onSelect={() => onSelectTab(tab.id)}
          onClose={() => onCloseTab(tab.id)}
          onMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, index })
          }}
        />
      ))}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={itemsMenuPestana(tabs, menu.index, closeIds, onSaveTab)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
