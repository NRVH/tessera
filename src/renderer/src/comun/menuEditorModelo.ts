// =============================================================================
// Modelo PURO del menú contextual de los editores de código: qué opciones salen y en qué orden.
// Sin Monaco ni React, para probarlo con `node`: el editor le dice qué puede (solo lectura,
// qué acciones soporta el lenguaje, las acciones propias del panel) y recibe las entradas.
// Lo usa `menuEditor.ts`. Decisiones: docs/decisiones/renderer/menu-contextual.md
// =============================================================================

/** Las acciones de serie del editor que entran en el menú, por su id. */
export const ACCION = {
  irADefinicion: 'editor.action.revealDefinition',
  verReferencias: 'editor.action.goToReferences',
  renombrarSimbolo: 'editor.action.rename',
  cambiarOcurrencias: 'editor.action.changeAll',
  formatear: 'editor.action.formatDocument',
  cortar: 'editor.action.clipboardCutAction',
  copiar: 'editor.action.clipboardCopyAction',
  pegar: 'editor.action.clipboardPasteAction',
  seleccionarTodo: 'editor.action.selectAll'
} as const

export type IdAccionDeSerie = (typeof ACCION)[keyof typeof ACCION]

/** Una acción que un panel añade al menú de su editor (ejecutar, historial…). */
export interface AccionPropia {
  id: string
  label: string
  /** Grupo del menú: las de un mismo grupo van juntas, entre separadores. */
  grupo: string
  orden: number
}

/** Lo que el modelo necesita saber del editor en el momento del clic. */
export interface EstadoEditor {
  soloLectura: boolean
  /** Acciones de serie que el lenguaje del modelo admite (ir a la definición, formatear…). */
  soportadas: ReadonlySet<string>
  propias: readonly AccionPropia[]
}

export type EntradaMenuEditor = { id: string; label: string; deshabilitada?: boolean } | { separador: true }

/** Etiquetas de las acciones de serie, en el idioma de la app. */
export type EtiquetasMenuEditor = Record<keyof typeof ACCION, string>

const SEPARADOR: EntradaMenuEditor = { separador: true }

/** Las acciones propias, agrupadas por grupo y ordenadas, con un separador entre grupos. */
function grupoPropio(propias: readonly AccionPropia[]): EntradaMenuEditor[] {
  const ordenadas = [...propias].sort((a, b) => a.grupo.localeCompare(b.grupo) || a.orden - b.orden)
  const out: EntradaMenuEditor[] = []
  ordenadas.forEach((a, i) => {
    if (i > 0 && ordenadas[i - 1].grupo !== a.grupo) out.push(SEPARADOR)
    out.push({ id: a.id, label: a.label })
  })
  return out
}

/**
 * Entradas del menú. Orden por tipo de consecuencia: lo del panel, navegar por el código,
 * cambiar el texto y el portapapeles. En solo lectura no sale lo que edita, salvo cortar y
 * pegar, que salen apagados: el usuario ve que el editor no admite cambios. Los separadores
 * sobrantes los limpia el `ContextMenu`.
 */
export function entradasMenuEditor(estado: EstadoEditor, et: EtiquetasMenuEditor): EntradaMenuEditor[] {
  const si = (clave: keyof typeof ACCION): boolean => estado.soportadas.has(ACCION[clave])
  const opcion = (clave: keyof typeof ACCION, deshabilitada = false): EntradaMenuEditor =>
    deshabilitada ? { id: ACCION[clave], label: et[clave], deshabilitada } : { id: ACCION[clave], label: et[clave] }
  const navegar: EntradaMenuEditor[] = []
  if (si('irADefinicion')) navegar.push(opcion('irADefinicion'))
  if (si('verReferencias')) navegar.push(opcion('verReferencias'))
  const editar: EntradaMenuEditor[] = []
  if (!estado.soloLectura) {
    if (si('renombrarSimbolo')) editar.push(opcion('renombrarSimbolo'))
    editar.push(opcion('cambiarOcurrencias'))
    if (si('formatear')) editar.push(opcion('formatear'))
  }
  return [
    ...grupoPropio(estado.propias),
    SEPARADOR,
    ...navegar,
    SEPARADOR,
    ...editar,
    SEPARADOR,
    opcion('cortar', estado.soloLectura),
    opcion('copiar'),
    opcion('pegar', estado.soloLectura),
    SEPARADOR,
    opcion('seleccionarTodo')
  ]
}
