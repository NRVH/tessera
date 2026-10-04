// =============================================================================
// Producción en la consola: qué pide confirmación antes de enviar un lote o un COMMIT en
// una conexión de producción, qué dice ese diálogo, en qué modo de transacción se ve una
// consola sin sesión y cómo se lee un rechazo del main. Puro: `useConsola` decide CUÁNDO
// preguntar y aquí vive QUÉ; la clasificación es la de `shared/sql/produccionSql.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import type { DbErrorSql, DbEstadoSesion, DbEstadoTx, DbTxModo } from '../../../../../shared/db-explorador-ipc.ts'
import type { DbEntorno } from '../../../../../shared/db-ipc.ts'
import type { Clasificacion } from '../../../../../shared/sql/clasificarSql.ts'
import { descriptorSql } from '../../../../../shared/motores/index.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import {
  esEntornoProduccion,
  modoTxInicial,
  plsqlConCommitEscrito,
  requiereConfirmacionProduccion
} from '../../../../../shared/sql/produccionSql.ts'
import { recortarCentro } from '../dbTabsModel.ts'
import { cantidad, textoError } from './salidaConsola.ts'

/** Una sentencia del lote que escribe en producción. `indice` = posición en el lote. */
export interface EscrituraProduccion {
  indice: number
  verbo: string
}

export type PrevueloProduccion = { confirmar: false } | { confirmar: true; escrituras: EscrituraProduccion[] }

/** Lo que un diálogo de confirmación necesita (el `ConfirmDialog` de la consola). */
export interface TextosConfirmacion {
  titulo: string
  mensaje: string
  confirmar: string
}

/** Lo mínimo de un peligro (DML sin WHERE…) para ir dentro del diálogo de producción. */
export interface PeligroEnConfirmacion {
  motivo: string
  extracto: string
}

/** Tope del alias en el TÍTULO del diálogo (en el mensaje va entero). */
const ALIAS_TITULO_MAX = 40

/** Etiqueta del botón que acepta un lote en producción. */
export const ETIQUETA_EJECUTAR_PRODUCCION = 'Ejecutar en producción'
/** Etiqueta del botón que acepta el COMMIT en producción. */
export const ETIQUETA_COMMIT_PRODUCCION = 'Confirmar (Commit)'

/** ¿Es una conexión de producción? La regla vive en `shared/sql/produccionSql.ts`. */
export function esProduccion(entorno: DbEntorno | null | undefined): boolean {
  return esEntornoProduccion(entorno)
}

/**
 * El prevuelo de producción: fuera de producción, nunca se pregunta; en producción, se
 * pregunta si ALGUNA sentencia del lote escribe, y se devuelven todas las que lo hacen.
 */
export function prevueloProduccion(
  sentencias: readonly Pick<Clasificacion, 'clase' | 'verbo'>[],
  entorno: DbEntorno | null | undefined
): PrevueloProduccion {
  if (!esProduccion(entorno)) return { confirmar: false }
  const escrituras: EscrituraProduccion[] = []
  sentencias.forEach((s, indice) => {
    if (requiereConfirmacionProduccion(s)) escrituras.push({ indice, verbo: s.verbo || 'Sentencia' })
  })
  return escrituras.length === 0 ? { confirmar: false } : { confirmar: true, escrituras }
}

/** Los verbos agrupados en el orden en que aparecen: `UPDATE (2), DELETE`. */
export function resumenVerbos(escrituras: readonly EscrituraProduccion[]): string {
  const cuenta = new Map<string, number>()
  for (const e of escrituras) cuenta.set(e.verbo, (cuenta.get(e.verbo) ?? 0) + 1)
  return [...cuenta].map(([v, n]) => (n > 1 ? `${v} (${n})` : v)).join(', ')
}

/** «La sentencia escribe…» / «Las 3 sentencias escriben…» / «Escriben 2 de las 3…». */
function fraseEscrituras(total: number, escrituras: readonly EscrituraProduccion[]): string {
  const n = escrituras.length
  const verbos = resumenVerbos(escrituras)
  if (n === total) return total === 1 ? `La sentencia escribe: ${verbos}.` : `Las ${total} sentencias escriben: ${verbos}.`
  return n === 1 ? `Escribe 1 de las ${total} sentencias: ${verbos}.` : `Escriben ${n} de las ${total} sentencias: ${verbos}.`
}

/** Un DDL que confirmará de rebote lo pendiente: cuántas sentencias y en qué motor. */
export interface CommitImplicitoDdl {
  /** Sentencias pendientes; 0 = hay pero el main no dio la cuenta. */
  sentencias: number
  /** Nombre del motor para la frase («En Oracle, un DDL…»): `descriptor(d).etiqueta`. */
  motor: string
}

/**
 * ¿Este lote CONFIRMA de rebote los cambios pendientes de la consola? Un DDL de Oracle
 * hace COMMIT de la transacción antes de ejecutarse, y la confirmación lo dice; qué motores lo
 * hacen lo dice su descriptor (`sesion.ddlConfirmaImplicito`). Devuelve cuántas
 * sentencias hay pendientes (0 si el main no dio la cuenta) o null si no pasa: un motor
 * con DDL transaccional, ningún DDL en el lote, o nada `pendiente` en la sesión.
 */
export function pendientesQueConfirmaDdl(
  sentencias: readonly Pick<Clasificacion, 'clase'>[],
  dialecto: DialectoSql,
  sesion: Pick<DbEstadoSesion, 'tx' | 'sentenciasEnTx'> | null | undefined
): CommitImplicitoDdl | null {
  const motor = descriptorSql(dialecto)
  if (!motor.sesion.ddlConfirmaImplicito || !sesion || sesion.tx !== 'pendiente') return null
  if (!sentencias.some((s) => s.clase === 'ddl')) return null
  return { sentencias: sesion.sentenciasEnTx > 0 ? sesion.sentenciasEnTx : 0, motor: motor.etiqueta }
}

/** Bloques del lote con un COMMIT escrito y, si la consola tiene cambios pendientes, cuántos. */
export interface CommitEnBloques {
  bloques: number
  /** Sentencias pendientes que confirmará de rebote; 0 = hay pero no se sabe cuántas; null = nada pendiente. */
  pendientes: number | null
}

/**
 * Oracle: ¿algún bloque PL/SQL anónimo del lote lleva un COMMIT escrito? Es una decisión
 * que confirme sin el diálogo del COMMIT (el bloque ya pasó por la confirmación de
 * producción), y esa confirmación lo DICE. La regla es `plsqlConCommitEscrito` de
 * `shared/sql/produccionSql.ts`, la del main. Un CALL cuyo procedimiento confirma, o un
 * COMMIT en SQL dinámico, no se ve y no se adivina: un aviso en todos dejaría de leerse. null en un motor donde un bloque no confirma por dentro sin que
 * se vea (`sesion.rutinasConfirmanPorDentro`; en PostgreSQL un COMMIT dentro de una
 * transacción falla), en Auto (el trabajador ya confirma cada sentencia: no hay
 * confirmación del COMMIT que saltarse ni nada pendiente, y la frase sería falsa y ruido
 * en cada bloque), sin bloques con COMMIT, o sin nada que decir. Sin sesión todavía
 * cuenta como Manual: es el modo con el que el main abre la de producción
 * (`modoTxInicial`).
 */
export function commitEnBloques(
  sentencias: readonly (Pick<Clasificacion, 'clase'> & { texto: string })[],
  dialecto: DialectoSql,
  sesion: Pick<DbEstadoSesion, 'tx' | 'sentenciasEnTx' | 'txModo'> | null | undefined
): CommitEnBloques | null {
  if (!descriptorSql(dialecto).sesion.rutinasConfirmanPorDentro) return null
  if (sesion && sesion.txModo === 'auto') return null
  let bloques = 0
  for (const s of sentencias) {
    // La MISMA regla con la que el main sabe que ese bloque lleva una confirmación en
    // camino (`plsqlConCommitEscrito`, compartida: ver su cabecera).
    if (plsqlConCommitEscrito(s, dialecto)) bloques++
  }
  if (bloques === 0) return null
  const pendientes = sesion && sesion.tx === 'pendiente' ? Math.max(0, sesion.sentenciasEnTx) : null
  return { bloques, pendientes }
}

/**
 * Los textos de la confirmación de un lote en producción: el alias (entero en el
 * mensaje, recortado por el centro en el título), cuántas sentencias escriben y cuáles,
 * los peligros del lote si los hay (van aquí en vez de en su propio diálogo) y, en
 * Oracle, el COMMIT implícito de lo pendiente (`commitImplicito`) y el COMMIT escrito
 * dentro de un bloque (`commitEnBloque`).
 */
export function confirmacionLoteProduccion(o: {
  alias: string
  total: number
  escrituras: readonly EscrituraProduccion[]
  peligros?: readonly PeligroEnConfirmacion[]
  commitImplicito?: CommitImplicitoDdl | null
  commitEnBloque?: CommitEnBloques | null
}): TextosConfirmacion {
  const partes = [`«${o.alias}» es una conexión de producción.`, fraseEscrituras(o.total, o.escrituras)]
  const peligros = o.peligros ?? []
  if (peligros.length > 0) partes.push(peligros.map((p) => `· ${p.motivo}\n   ${p.extracto}`).join('\n'))
  if (o.commitImplicito) {
    const n = o.commitImplicito.sentencias
    const cuantas = n > 0 ? ` (${cantidad(n, 'sentencia', 'sentencias')})` : ''
    partes.push(
      `En ${o.commitImplicito.motor}, un DDL hace COMMIT de lo pendiente: los cambios sin confirmar de esta consola${cuantas} ` +
        'quedarán confirmados y ya no se podrán revertir.'
    )
  }
  if (o.commitEnBloque) {
    const { bloques, pendientes } = o.commitEnBloque
    const sujeto =
      o.total === 1
        ? 'Este bloque contiene un COMMIT'
        : bloques === 1
          ? 'Un bloque del lote contiene un COMMIT'
          : `${bloques} bloques del lote contienen un COMMIT`
    const efecto =
      pendientes === null
        ? 'lo escrito hasta ese punto queda confirmado sin pasar por la confirmación del COMMIT, y ya no se podrá revertir.'
        : `confirma también los cambios sin confirmar de esta consola${
            pendientes > 0 ? ` (${cantidad(pendientes, 'sentencia', 'sentencias')})` : ''
          } sin pasar por la confirmación del COMMIT, y ya no se podrán revertir.`
    partes.push(`${sujeto}: ${efecto}`)
  }
  return {
    titulo: `Producción: ¿ejecutar en ${recortarCentro(o.alias, ALIAS_TITULO_MAX)}?`,
    mensaje: partes.join('\n\n'),
    confirmar: ETIQUETA_EJECUTAR_PRODUCCION
  }
}

/** ¿Pide confirmación el Commit de la barra? Solo en producción. (El Rollback, nunca.) */
export function commitPideConfirmacion(entorno: DbEntorno | null | undefined): boolean {
  return esProduccion(entorno)
}

/** Los textos de la confirmación del COMMIT de la barra en producción. */
export function confirmacionCommitProduccion(o: { alias: string; sentenciasEnTx: number }): TextosConfirmacion {
  const cuantas = o.sentenciasEnTx > 0 ? ` (${cantidad(o.sentenciasEnTx, 'sentencia', 'sentencias')})` : ''
  return {
    titulo: `Producción: ¿confirmar en ${recortarCentro(o.alias, ALIAS_TITULO_MAX)}?`,
    mensaje:
      `«${o.alias}» es una conexión de producción.\n\n` +
      `El COMMIT hace definitivos los cambios pendientes de esta consola${cuantas}.`,
    confirmar: ETIQUETA_COMMIT_PRODUCCION
  }
}

/**
 * El `contexto` de `DialogoTxPendiente` (cerrar la consola, pasar a Auto): su
 * «Confirmar (Commit)» es un COMMIT, así que en producción nombra la conexión y lo dice
 * (sin añadir otra pregunta: ya es una elección explícita). Sin producción, o con la tx `fallida` (ahí no se ofrece Commit),
 * el contexto de siempre.
 */
export function contextoTxPendiente(
  contexto: string,
  o: { alias: string; entorno: DbEntorno | null | undefined; tx: DbEstadoTx }
): string {
  if (!esProduccion(o.entorno) || o.tx === 'fallida') return contexto
  return `${contexto}\n«${o.alias}» es una conexión de producción: «Confirmar (Commit)» hace definitivos los cambios.`
}

/**
 * El modo en que ARRANCA una consola nueva, para pintar la barra mientras no hay
 * sesión: Auto en solo lectura, Manual en producción, y en lo demás la preferencia de
 * Configuración (`preferencia`, Auto si no se da). Es la MISMA regla que usa el main al
 * crear la sesión (`modoTxInicial`, compartida), y la preferencia es la misma que viaja
 * en la petición que la crea.
 */
export function modoTxPorDefecto(
  entorno: DbEntorno | null | undefined,
  soloLectura: boolean,
  preferencia: DbTxModo = 'auto'
): DbTxModo {
  return modoTxInicial(entorno, soloLectura, preferencia)
}

/**
 * ¿El mensaje del main ya dice que no se envió nada? El de `produccion.ts` lo dice
 * («… No se envió nada.»), y prefijarlo otra vez daba «No se envió: … No se envió nada».
 * Se mira el TEXTO y no se da por hecho: un main anterior, u otro mensaje, puede no
 * decirlo, y entonces el prefijo es lo que tranquiliza.
 */
const YA_DICE_NO_ENVIADO = /no se envi[oó]/i

/** Una sentencia que el main rechazó por 'produccion': no llegó al servidor. */
export function textoRechazoProduccion(error: Pick<DbErrorSql, 'codigo' | 'mensaje'>): string {
  const t = textoError(error)
  return YA_DICE_NO_ENVIADO.test(t) ? t : `No se envió: ${t}`
}

/** Un COMMIT que el main rechazó por 'produccion': no se confirmó nada. */
export function textoCommitRechazado(error: Pick<DbErrorSql, 'codigo' | 'mensaje'>): string {
  const t = textoError(error)
  return YA_DICE_NO_ENVIADO.test(t) ? t : `No se confirmó: ${t}`
}
