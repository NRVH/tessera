// =============================================================================
// Menú contextual de los editores de código: el de Tessera en vez del de serie de Monaco, que
// tiene otro aspecto y no está traducido. Se instala una vez para TODOS los editores (también
// los dos lados de un diff) al crearse cada uno, y el clic derecho abre el `ContextMenu` común
// a través de `MenuDeEditores.tsx`. Las acciones propias de un panel entran con
// `agregarAccionesConMenu`. Qué opciones salen: `menuEditorModelo.ts`.
// Decisiones: docs/decisiones/renderer/menu-contextual.md
// =============================================================================

import type * as Monaco from 'monaco-editor'
import type { editor, IDisposable } from 'monaco-editor'
import type { ContextMenuEntry } from './contextMenuModel'
import { ACCION, entradasMenuEditor, type AccionPropia } from './menuEditorModelo.ts'
import { txComun } from './textos.ts'

/** Un menú abierto: dónde, qué ofrece y a qué editor devolver el foco al cerrarse. */
export interface MenuEditorAbierto {
  x: number
  y: number
  entradas: ContextMenuEntry[]
  editor: editor.ICodeEditor
}

let abierto: MenuEditorAbierto | null = null
const oyentes = new Set<() => void>()
const propias = new WeakMap<editor.ICodeEditor, AccionPropia[]>()

function avisar(): void {
  for (const fn of oyentes) fn()
}

/** Para `useSyncExternalStore` del anfitrión. */
export function suscribirMenuEditor(fn: () => void): () => void {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}

export function menuEditorAbierto(): MenuEditorAbierto | null {
  return abierto
}

/** Cierra el menú; con `devolverFoco`, el foco vuelve al editor (Escape o clic fuera). */
export function cerrarMenuEditor(devolverFoco: boolean): void {
  if (!abierto) return
  const ed = abierto.editor
  abierto = null
  avisar()
  if (devolverFoco) ed.focus()
}

/**
 * Registra acciones del panel en su editor; las que traen `contextMenuGroupId` salen además en
 * el menú. Sustituye a `ed.addAction` en los paneles que añaden opciones al menú.
 */
export function agregarAccionesConMenu(
  ed: editor.IStandaloneCodeEditor,
  acciones: readonly editor.IActionDescriptor[]
): IDisposable[] {
  return acciones.map((d) => {
    const registro = ed.addAction(d)
    if (d.contextMenuGroupId === undefined) return registro
    const propia: AccionPropia = { id: d.id, label: d.label, grupo: d.contextMenuGroupId, orden: d.contextMenuOrder ?? 0 }
    propias.set(ed, [...(propias.get(ed) ?? []), propia])
    return {
      dispose: () => {
        registro.dispose()
        propias.set(ed, (propias.get(ed) ?? []).filter((a) => a !== propia))
      }
    }
  })
}

/** Las entradas del menú para el estado actual del editor; cada una ejecuta su acción en él. */
function entradasDe(monaco: typeof Monaco, ed: editor.ICodeEditor): ContextMenuEntry[] {
  const soportadas = new Set<string>()
  for (const id of Object.values(ACCION)) if (ed.getAction(id)?.isSupported()) soportadas.add(id)
  const entradas = entradasMenuEditor(
    {
      soloLectura: ed.getOption(monaco.editor.EditorOption.readOnly),
      soportadas,
      propias: propias.get(ed) ?? []
    },
    txComun().menuEditor
  )
  return entradas.map((e) =>
    'separador' in e
      ? { separator: true }
      : {
          label: e.label,
          disabled: e.deshabilitada,
          onClick: () => {
            ed.focus()
            ed.trigger('tessera.menu', e.id, null)
          }
        }
  )
}

/** Dónde abrir el menú: en el ratón o, si vino del teclado, junto al cursor de texto. */
function posicionDe(monaco: typeof Monaco, ed: editor.ICodeEditor, e: editor.IEditorMouseEvent): { x: number; y: number } {
  if (e.target.type !== monaco.editor.MouseTargetType.TEXTAREA) return { x: e.event.posx, y: e.event.posy }
  const caja = ed.getDomNode()?.getBoundingClientRect()
  const pos = ed.getPosition()
  const visible = pos ? ed.getScrolledVisiblePosition(pos) : null
  if (!caja || !visible) return { x: e.event.posx, y: e.event.posy }
  return { x: caja.left + visible.left, y: caja.top + visible.top + visible.height }
}

/** Tipos de destino en los que el clic derecho abre el menú: el texto y su área, no márgenes ni barras. */
function abreMenu(monaco: typeof Monaco, tipo: editor.MouseTargetType): boolean {
  const T = monaco.editor.MouseTargetType
  return tipo === T.CONTENT_TEXT || tipo === T.CONTENT_EMPTY || tipo === T.TEXTAREA
}

function conMenuDeTessera(monaco: typeof Monaco, ed: editor.ICodeEditor): void {
  // Sin el de serie, Monaco solo enfoca y lleva el cursor al clic si cae fuera de la selección.
  ed.updateOptions({ contextmenu: false })
  ed.onContextMenu((e) => {
    if (!abreMenu(monaco, e.target.type)) return
    e.event.preventDefault()
    abierto = { ...posicionDe(monaco, ed, e), entradas: entradasDe(monaco, ed), editor: ed }
    avisar()
  })
}

let instalado = false

/** Engancha el menú de Tessera a cada editor que se cree desde ahora. Idempotente. */
export function instalarMenuEditor(monaco: typeof Monaco): void {
  if (instalado) return
  instalado = true
  // Mayús+F10 es el atajo del menú de serie, que ya no existe: sin quitarlo, el editor se
  // quedaría la tecla y el sistema no emitiría el `contextmenu` que abre el de Tessera.
  const { KeyMod, KeyCode } = monaco
  monaco.editor.addKeybindingRule({ keybinding: KeyMod.Shift | KeyCode.F10, command: '-editor.action.showContextMenu' })
  monaco.editor.onDidCreateEditor((ed) => conMenuDeTessera(monaco, ed))
}
