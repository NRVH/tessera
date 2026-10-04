// =============================================================================
// filasArbolBdSesiones — lo que el árbol de BD dice de las sesiones de una conexión: el
// punto de sesión, qué desconectar, las transacciones pendientes y qué ofrece el diálogo
// de transacciones (sin Confirmar si todas fallaron). Puro; lo reexporta `filasArbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-filas-y-carga.md
// =============================================================================

import type { DbConsolaInfo, DbEstadoSesion, DbRefSesion } from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'

export type EstadoSesionConexion = 'conectada' | 'conectando' | 'caida' | null

/** El punto de sesión de una conexión: una viva basta; «caída» solo sin ninguna viva. null = sin sesiones. */
export function estadoSesionConexion(
  sesiones: readonly DbEstadoSesion[],
  conexionId: string
): EstadoSesionConexion {
  let abriendo = false
  let perdida = false
  for (const s of sesiones) {
    if (s.conexionId !== conexionId) continue
    if (s.fase === 'lista' || s.fase === 'ocupada') return 'conectada'
    if (s.fase === 'abriendo') abriendo = true
    else if (s.fase === 'perdida') perdida = true
  }
  if (abriendo) return 'conectando'
  return perdida ? 'caida' : null
}

/** ¿Hay algo que desconectar? (cualquier sesión que no esté cerrada, perdida incluida). */
export function tieneSesiones(sesiones: readonly DbEstadoSesion[], conexionId: string): boolean {
  return sesiones.some((s) => s.conexionId === conexionId && s.fase !== 'cerrada')
}

/** Sesiones de la conexión con una transacción que no está en `ninguna`. */
export function sesionesConTx(sesiones: readonly DbEstadoSesion[], conexionId: string): DbEstadoSesion[] {
  return sesiones.filter((s) => s.conexionId === conexionId && s.tx !== 'ninguna')
}

/** Sesiones con cambios de verdad sin confirmar (una `abierta` de PG solo leyó). */
export function sesionesConCambios(sesiones: readonly DbEstadoSesion[], conexionId: string): DbEstadoSesion[] {
  return sesiones.filter((s) => s.conexionId === conexionId && (s.tx === 'pendiente' || s.tx === 'fallida'))
}

/**
 * Nombres legibles de las sesiones que un error `txPendiente` lista: el nombre de cada consola
 * ("consola_2"), y para las sesiones internas, qué son. Sin repetidos.
 */
export function nombresDeRefs(refs: readonly DbRefSesion[], consolas: readonly DbConsolaInfo[]): string[] {
  const out: string[] = []
  for (const r of refs) {
    let nombre: string
    if (r.rol === 'consola') {
      const k = consolas.find((c) => c.id === r.consolaId)
      nombre = k ? k.nombre : 'una consola'
    } else {
      nombre = r.rol === 'datos' ? 'las pestañas de datos' : 'el árbol'
    }
    if (out.indexOf(nombre) === -1) out.push(nombre)
  }
  return out
}

/** ¿Las dos refs nombran la misma sesión? */
function mismaSesion(a: DbRefSesion, b: DbRefSesion): boolean {
  if (a.rol === 'consola' || b.rol === 'consola') {
    return a.rol === 'consola' && b.rol === 'consola' && a.perfilId === b.perfilId && a.consolaId === b.consolaId
  }
  return a.rol === b.rol && a.conexionId === b.conexionId
}

/** ¿La sesión de esa ref se sabe en tx `fallida`? (Sin sesión conocida, no.) */
function esFallida(r: DbRefSesion, sesiones: readonly DbEstadoSesion[]): boolean {
  return sesiones.some((s) => mismaSesion(s.ref, r) && s.tx === 'fallida')
}

/**
 * ¿TODAS las sesiones que una operación del árbol tiene que resolver están en tx `fallida`?
 * Entonces su diálogo solo ofrece Revertir: el main rechaza «Confirmar» sobre una fallida. Una
 * ref sin sesión conocida cuenta como confirmable: la lista puede ir un evento por detrás, y si
 * de verdad era fallida, el main la revierte igual.
 */
export function soloSePuedeRevertir(refs: readonly DbRefSesion[], sesiones: readonly DbEstadoSesion[]): boolean {
  if (refs.length === 0) return false
  return refs.every((r) => esFallida(r, sesiones))
}

/** Lo que el diálogo de transacciones del árbol ofrece y dice. */
export interface OpcionesTxArbol {
  /** Etiqueta de Confirmar, o null si no se ofrece (todas fallidas). */
  confirmar: string | null
  revertir: string
  /** Línea bajo el mensaje: por qué no hay Confirmar, o cuántas se revertirán. Null si nada. */
  nota: string | null
}

/**
 * Los botones del diálogo del árbol: sin fallidas, «Confirmar»/«Revertir»; con MEZCLA, el botón
 * dice que las fallidas se revierten (en bloque el main confirma las pendientes y revierte las
 * fallidas) y una nota cuenta cuántas; con TODAS fallidas, sin Confirmar y con el porqué. El
 * plural va por el número de sesiones; `varias` solo decide si el main no mandó la lista.
 */
export function opcionesTxArbol(
  refs: readonly DbRefSesion[],
  sesiones: readonly DbEstadoSesion[],
  varias: boolean
): OpcionesTxArbol {
  const plural = refs.length === 0 ? varias : refs.length > 1
  const revertir = plural ? 'Revertir todas' : 'Revertir'
  if (soloSePuedeRevertir(refs, sesiones)) {
    return { confirmar: null, revertir, nota: motivoSoloRevertir(refs.length) }
  }
  const fallidas = refs.filter((r) => esFallida(r, sesiones)).length
  if (fallidas === 0) return { confirmar: plural ? 'Confirmar todas' : 'Confirmar', revertir, nota: null }
  return {
    confirmar: fallidas === 1 ? 'Confirmar (la fallida se revierte)' : 'Confirmar (las fallidas se revierten)',
    revertir,
    nota:
      fallidas === 1
        ? `1 de las ${refs.length} transacciones falló y se revertirá aunque confirmes: una transacción fallida solo se puede revertir.`
        : `${fallidas} de las ${refs.length} transacciones fallaron y se revertirán aunque confirmes: una transacción fallida solo se puede revertir.`
  }
}

/**
 * Aviso tras una resolución en bloque que confirmó y revirtió las fallidas: qué se revirtió, por
 * nombre. Null si no se revirtió nada.
 */
export function avisoRevertidas(
  alias: string,
  revertidas: readonly DbRefSesion[],
  consolas: readonly DbConsolaInfo[]
): string | null {
  if (revertidas.length === 0) return null
  // Sin comillas: `nombresDeRefs` también devuelve «el árbol» o «las pestañas de datos».
  const nombres = nombresDeRefs(revertidas, consolas)
  const quien = nombres.length > 0 ? ` (${nombres.join(', ')})` : ''
  return revertidas.length === 1
    ? `${alias}: se confirmó lo pendiente y se revirtió la transacción fallida${quien}.`
    : `${alias}: se confirmó lo pendiente y se revirtieron las ${revertidas.length} transacciones fallidas${quien}.`
}

/**
 * La línea que dice por qué el diálogo del árbol no ofrece Confirmar. Por el NÚMERO de sesiones
 * y no por el plural de los botones: con una sola fallida no se dice «todas».
 */
export function motivoSoloRevertir(sesiones: number): string {
  return sesiones > 1
    ? `Las ${sesiones} transacciones fallaron, y una transacción fallida solo se puede revertir.`
    : 'La transacción falló: solo se puede revertir.'
}

/** El porqué de «Desconectar» apagado sin nada de una conexión seleccionado. */
export const MOTIVO_DESCONECTAR_SIN_SELECCION = 'Elige una conexión (o algo dentro de ella) para desconectarla'

/**
 * «Desconectar» de la cabecera del árbol: su título y el porqué de apagarse (null = vivo). La
 * regla es la del menú contextual de la conexión (`tieneSesiones`); `conexion` es la de la
 * selección ya resuelta (una ajena o nada, null).
 */
export function accionDesconectarCabecera(
  conexion: Pick<DbConnection, 'id' | 'alias'> | null | undefined,
  sesiones: readonly DbEstadoSesion[]
): { titulo: string; motivo: string | null } {
  if (!conexion) return { titulo: 'Desconectar', motivo: MOTIVO_DESCONECTAR_SIN_SELECCION }
  return {
    titulo: `Desconectar ${conexion.alias}`,
    motivo: tieneSesiones(sesiones, conexion.id) ? null : `${conexion.alias} no está conectada`
  }
}
