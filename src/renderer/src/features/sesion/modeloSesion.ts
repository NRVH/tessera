// =============================================================================
// La traducción entre lo vivo y la sesión guardada de un proyecto (`shared/sesionProyecto.ts`): qué se guarda
// de las pestañas del editor, las carpetas del explorador y las terminales, y cómo vuelven las pestañas al
// reabrir. Solo se guardan los archivos: los diffs y los sin título no son un archivo que se pueda reabrir.
// Puro: lo carga `node` a secas.
// Decisiones: docs/decisiones/workspace/sesion-de-cada-proyecto.md
// =============================================================================

import type { PestanaGuardada, SesionProyecto } from '../../../../shared/sesionProyecto.ts'
import { normalizarSesion } from '../../../../shared/sesionProyecto.ts'
import type { PestanaEditor, EstadoPestanasEditor, ModoVista } from '../editor'
import type { TerminalesProyecto } from '../terminales'

/** La clave de un pane del editor (`clavePaneEditor`): entra por parámetro para no depender del editor al cargar. */
export type ClavePane = (claveDestino: string, pestanaId: string) => string

/** Lo vivo de un proyecto, leído de los stores (o de lo que aún no se ha restaurado). */
export interface FuentesSesion {
  clavePane: ClavePane
  pestanas: EstadoPestanasEditor | undefined
  /** El modo de vista de un pane (`clavePaneEditor`). */
  modoDe: (pk: string) => ModoVista | undefined
  /** El modo con que se abre un archivo de serie: ese no se guarda (`modoInicialPara`). */
  modoDeSerie: (ruta: string) => ModoVista
  /** La posición del cursor de un archivo (`claveModeloTexto`, que para un archivo es su `clavePaneEditor`). */
  cursorDe: (pk: string) => { linea: number; columna: number } | undefined
  carpetas: readonly string[] | undefined
  terminales: TerminalesProyecto | undefined
  /** El orden propio de su tira de terminales, si lo tiene (`ordenTiraAGuardar`). */
  ordenTerminales?: readonly string[]
}

/** Las pestañas guardadas de lo vivo: solo archivos, con su modo y su cursor. */
function pestanasDe(clave: string, f: FuentesSesion): { pestanas: PestanaGuardada[]; activa: string | null } {
  const estado = f.pestanas
  if (!estado) return { pestanas: [], activa: null }
  const pestanas: PestanaGuardada[] = []
  for (const pestana of estado.pestanas) {
    if (pestana.pane.tipo !== 'file') continue
    const pk = f.clavePane(clave, pestana.id)
    const p: PestanaGuardada = { ruta: pestana.pane.archivo.ruta }
    const modo = f.modoDe(pk)
    if (modo !== undefined && modo !== f.modoDeSerie(p.ruta)) p.modo = modo
    const cursor = f.cursorDe(pk)
    // El principio no se guarda: es donde se abre igual.
    if (cursor && (cursor.linea > 1 || cursor.columna > 1)) {
      p.linea = cursor.linea
      p.columna = cursor.columna
    }
    pestanas.push(p)
  }
  const activa = estado.pestanas.find((t) => t.id === estado.pestanaActivaId && t.pane.tipo === 'file')
  return { pestanas, activa: activa?.pane.tipo === 'file' ? activa.pane.archivo.ruta : null }
}

/** La sesión que se guarda de un proyecto, o null si no hay nada que recordar. Ya saneada. */
export function sesionDesde(clave: string, f: FuentesSesion): SesionProyecto | null {
  const { pestanas, activa } = pestanasDe(clave, f)
  const lista = f.terminales?.lista ?? []
  const terminales = lista.map((t) => (t.nombre ? { nombre: t.nombre } : {}))
  const terminalActiva = lista.findIndex((t) => t.id === f.terminales?.activoId)
  return normalizarSesion({ pestanas, activa, carpetas: f.carpetas ?? [], terminales, terminalActiva, ordenTerminales: f.ordenTerminales })
}

/** Lo que se aplica a los stores del editor al reabrir un proyecto. */
export interface AplicacionEditor {
  pestanas: EstadoPestanasEditor
  /** Modo de vista por pane, para los que lo tenían guardado. */
  modos: [string, ModoVista][]
  /** Posición del cursor por pane, para volver a ella al cargar el archivo. */
  cursores: [string, { linea: number; columna: number }][]
}

/** El nombre de una pestaña de archivo: la última parte de su ruta. */
function nombreDe(ruta: string): string {
  const i = ruta.lastIndexOf('/')
  return i === -1 ? ruta : ruta.slice(i + 1)
}

/**
 * Las pestañas de la sesión, mezcladas con las que el proyecto ya tenga (un archivo abierto desde el sistema
 * antes de restaurar): las guardadas que falten van delante, y la activa sigue siendo la que ya lo era.
 */
export function aplicacionEditor(
  clave: string,
  s: SesionProyecto,
  actuales: EstadoPestanasEditor | undefined,
  clavePane: ClavePane
): AplicacionEditor {
  const previas = actuales?.pestanas ?? []
  const yaAbiertas = new Set(previas.map((t) => t.id))
  const restauradas: PestanaEditor[] = []
  const modos: [string, ModoVista][] = []
  const cursores: [string, { linea: number; columna: number }][] = []
  for (const p of s.pestanas) {
    if (yaAbiertas.has(p.ruta)) continue
    restauradas.push({ id: p.ruta, pane: { tipo: 'file', archivo: { ruta: p.ruta, nombre: nombreDe(p.ruta) } } })
    const pk = clavePane(clave, p.ruta)
    if (p.modo) modos.push([pk, p.modo])
    if (p.linea !== undefined) cursores.push([pk, { linea: p.linea, columna: p.columna ?? 1 }])
  }
  const pestanas = [...restauradas, ...previas]
  return { pestanas: { pestanas, pestanaActivaId: activaTras(pestanas, actuales?.pestanaActivaId ?? null, s.activa) }, modos, cursores }
}

/** La activa tras restaurar: la que ya lo era, si no la guardada, si no la primera. */
function activaTras(pestanas: readonly PestanaEditor[], actual: string | null, guardada: string | null): string | null {
  if (actual !== null) return actual
  if (guardada !== null && pestanas.some((t) => t.id === guardada)) return guardada
  return pestanas[0]?.id ?? null
}
