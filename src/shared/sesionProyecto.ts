// =============================================================================
// La sesión de cada proyecto, tal cual se guarda en `workspace-state.json` (el slice `sesiones`, por
// `perfil|ruta`): las pestañas del editor (orden, la activa, modo de vista y posición del cursor), las
// carpetas desplegadas del explorador y las terminales locales (cuántas, sus nombres, la activa y su sitio en la tira). Solo
// rutas relativas al proyecto: una ruta absoluta, con `..` o con barra invertida se descarta, igual que
// todo lo que no tenga la forma esperada. Lo que no se guarda (diffs, archivos sin título, el contenido sin
// guardar) no tiene sitio aquí. Puro: lo comparten el main, el renderer y los tests.
// Decisiones: docs/decisiones/workspace/sesion-de-cada-proyecto.md
// =============================================================================

/** Los modos de vista de un archivo previsualizable (`renderer/features/editor/modoVista.ts`). */
export type ModoVistaGuardado = 'codigo' | 'dividida' | 'vista'

/** Una pestaña de archivo del editor. */
export interface PestanaGuardada {
  /** Ruta relativa al proyecto, POSIX. */
  ruta: string
  /** Modo de vista; ausente, el de serie del archivo. */
  modo?: ModoVistaGuardado
  /** Posición del cursor, en base 1; ausente, el principio. */
  linea?: number
  columna?: number
}

/** Una terminal local: el shell vuelve nuevo, solo con su nombre. */
export interface TerminalGuardada {
  /** Nombre puesto a mano; ausente, el automático. */
  nombre?: string
}

/** Lo que un proyecto recuerda entre sesiones. */
export interface SesionProyecto {
  pestanas: PestanaGuardada[]
  /** Ruta de la pestaña activa, o null. */
  activa: string | null
  /** Carpetas desplegadas del explorador, rutas relativas. */
  carpetas: string[]
  terminales: TerminalGuardada[]
  /** Índice de la terminal activa en `terminales`, o -1. */
  terminalActiva: number
  /** Orden de la tira, locales y SSH intercaladas (marcas de `tiraTerminalesModel`); ausente, el de serie. */
  ordenTerminales?: string[]
}

/** Topes: un archivo editado a mano o de otra versión no puede hacer crecer sin medida lo que se restaura. */
export const MAX_PESTANAS_GUARDADAS = 50
export const MAX_CARPETAS_GUARDADAS = 500
export const MAX_TERMINALES_GUARDADAS = 12
export const MAX_ORDEN_TERMINALES = 64
const MAX_MARCA_ORDEN = 256
const MAX_RUTA = 1024
const MAX_NOMBRE_TERMINAL = 80
const MAX_LINEA = 10_000_000

/** Una ruta relativa al proyecto que se puede pedir sin salir de él. */
export function rutaRelativaValida(v: unknown): v is string {
  if (typeof v !== 'string' || v === '' || v.length > MAX_RUTA) return false
  if (v.startsWith('/') || v.includes('\\') || v.includes('\0') || /^[a-zA-Z]:/.test(v)) return false
  return !v.split('/').some((seg) => seg === '..' || seg === '')
}

function enteroPositivo(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_LINEA ? v : undefined
}

function normalizarPestana(v: unknown): PestanaGuardada | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (!rutaRelativaValida(o.ruta)) return null
  const p: PestanaGuardada = { ruta: o.ruta }
  if (o.modo === 'codigo' || o.modo === 'dividida' || o.modo === 'vista') p.modo = o.modo
  const linea = enteroPositivo(o.linea)
  if (linea !== undefined) {
    p.linea = linea
    const columna = enteroPositivo(o.columna)
    if (columna !== undefined) p.columna = columna
  }
  return p
}

function normalizarTerminal(v: unknown): TerminalGuardada | null {
  if (typeof v !== 'object' || v === null) return null
  const nombre = (v as Record<string, unknown>).nombre
  if (typeof nombre !== 'string') return {}
  const limpio = nombre.trim().slice(0, MAX_NOMBRE_TERMINAL)
  return limpio === '' ? {} : { nombre: limpio }
}

/** ¿No hay nada que restaurar? Una sesión así no se guarda. */
export function sesionVacia(s: SesionProyecto): boolean {
  return s.pestanas.length === 0 && s.carpetas.length === 0 && s.terminales.length === 0
}

const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Las pestañas válidas, sin rutas repetidas (serían la misma pestaña dos veces) y con su tope. */
function normalizarPestanas(v: unknown): PestanaGuardada[] {
  const vistas = new Set<string>()
  const pestanas: PestanaGuardada[] = []
  for (const raw of lista(v)) {
    const p = normalizarPestana(raw)
    if (p === null || vistas.has(p.ruta)) continue
    vistas.add(p.ruta)
    pestanas.push(p)
    if (pestanas.length === MAX_PESTANAS_GUARDADAS) break
  }
  return pestanas
}

/** El índice de la terminal activa, dentro de la lista; la primera si no vale, -1 sin terminales. */
function indiceActiva(v: unknown, total: number): number {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < total) return v
  return total > 0 ? 0 : -1
}

/** Sanea la sesión de un proyecto; null si no hay nada válido que guardar. Nunca lanza. */
export function normalizarSesion(v: unknown): SesionProyecto | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const pestanas = normalizarPestanas(o.pestanas)
  const activa = typeof o.activa === 'string' && pestanas.some((p) => p.ruta === o.activa) ? o.activa : null
  const carpetas = [...new Set(lista(o.carpetas).filter(rutaRelativaValida))].slice(0, MAX_CARPETAS_GUARDADAS)
  const terminales = lista(o.terminales)
    .map(normalizarTerminal)
    .filter((t): t is TerminalGuardada => t !== null)
    .slice(0, MAX_TERMINALES_GUARDADAS)
  const s: SesionProyecto = { pestanas, activa, carpetas, terminales, terminalActiva: indiceActiva(o.terminalActiva, terminales.length) }
  if (sesionVacia(s)) return null
  const orden = normalizarOrden(o.ordenTerminales)
  return orden.length > 0 ? { ...s, ordenTerminales: orden } : s
}

/** Las marcas del orden de la tira: textos no vacíos, sin repetir y con su tope. Solo se comparan, nunca se ejecutan ni abren. */
function normalizarOrden(v: unknown): string[] {
  const marcas = lista(v).filter((m): m is string => typeof m === 'string' && m !== '' && m.length <= MAX_MARCA_ORDEN)
  return [...new Set(marcas)].slice(0, MAX_ORDEN_TERMINALES)
}

/**
 * Sanea las sesiones de todos los proyectos. Con `proyectosAbiertos` (claves `perfil|ruta`) se quedan solo
 * las de los proyectos abiertos: la de uno que se cierra se olvida con él.
 */
export function normalizarSesiones(v: unknown, proyectosAbiertos: readonly string[] | null): Record<string, SesionProyecto> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  const abiertos = proyectosAbiertos === null ? null : new Set(proyectosAbiertos)
  const out: Record<string, SesionProyecto> = {}
  for (const [clave, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!clave.includes('|') || (abiertos !== null && !abiertos.has(clave))) continue
    const s = normalizarSesion(raw)
    if (s !== null) out[clave] = s
  }
  return out
}
