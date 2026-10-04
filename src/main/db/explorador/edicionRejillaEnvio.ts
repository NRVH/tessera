// =============================================================================
// Preparación de «Enviar»: construye cada sentencia con `sentenciaDeCambio` (la misma función
// de la vista previa), adapta sus binds a la columna que los recibe, filtra los valores
// originales que el main sabe comparar y lleva a cada UPDATE/DELETE de Oracle la identidad de
// su fila para el candado. Puro; lo reexporta `edicionRejilla.ts`.
// Decisiones: docs/decisiones/bd/rejilla-envio-bloqueos.md, docs/decisiones/bd/rejilla-edicion-identidad.md
// =============================================================================

import type { DbMotor } from '../../../shared/db-ipc.ts'
import type { DbCambioFila, DbIdentidadFila, DbOriginalesFila } from '../../../shared/db-explorador-ipc.ts'
import { ErrorDml, sentenciaDeCambio, type ObjetoDml, type SentenciaDml } from '../../../shared/sql/dmlRejilla.ts'
import { citar } from '../../../shared/sql/identificadoresSql.ts'
import { valorOriginalComparable } from '../../../shared/sql/originalesSql.ts'
import { esperaPorFila } from './edicionRejillaBloqueos.ts'
import type { ColumnaEdicion } from './edicionRejillaTablas.ts'
import type { BindsEnvio, FalloCambio, SentenciaEnvio } from './edicionRejillaTipos.ts'
import { columnasPorNombre } from './edicionRejillaValidacion.ts'
import type { ClaseErrorTrabajador } from './protocoloTrabajador.ts'
import { motorExplorador } from './motores/index.ts'
import { COLUMNA_ROWID } from './sqlRejilla.ts'

/**
 * Los `originales` de un cambio que el main SABE comparar: solo con la identidad 'rowid',
 * solo columnas del catálogo con `comparable`, sin la del ROWID, y cada valor con la forma que
 * la sesión sabe leer. Lo demás se descarta EN SILENCIO. undefined = ninguno.
 */
export function originalesComparables(
  identidad: DbIdentidadFila,
  originales: DbOriginalesFila | undefined,
  columnas: readonly ColumnaEdicion[]
): DbOriginalesFila | undefined {
  if (!originales || identidad.tipo !== 'rowid') return undefined
  const porNombre = columnasPorNombre(columnas)
  const salida: DbOriginalesFila = {}
  let n = 0
  for (const nombre of Object.keys(originales)) {
    if (nombre === identidad.columna || nombre === COLUMNA_ROWID) continue
    const col = porNombre.get(nombre)
    // `!col.comparable` y no `=== null`: una entrada de caché de antes del campo no lo trae.
    if (!col || !col.comparable) continue
    const v = originales[nombre]
    // Se descarta la comprobación, no el cambio: NULL y '' siempre valen; un valor sin la
    // forma que la sesión sabe leer o un texto con U+FFFD (leído con pérdida) no casarían nunca.
    if (!valorOriginalComparable(col.comparable, v)) continue
    salida[nombre] = v
    n++
  }
  return n > 0 ? salida : undefined
}

/** El cambio con SOLO los originales comparables (o sin ellos). No toca el que llegó. */
function conOriginales(c: DbCambioFila, o: DbOriginalesFila | undefined): DbCambioFila {
  if (c.tipo === 'insertar') return c
  if (c.tipo === 'actualizar') {
    return o ? { tipo: 'actualizar', clave: c.clave, valores: c.valores, originales: o } : { tipo: 'actualizar', clave: c.clave, valores: c.valores }
  }
  return o ? { tipo: 'borrar', clave: c.clave, originales: o } : { tipo: 'borrar', clave: c.clave }
}

const HEX = /^0x[0-9a-f]*$/i

/**
 * Los binds de una sentencia adaptados a la columna que los recibe, o el motivo por el que uno
 * no vale. La forma de cada motor (clave binaria, LOB largo, juego nacional) está en
 * `motores/sesion*.ts`; aquí, lo común: el hexadecimal tiene que llegar bien formado.
 */
function adaptarBinds(motor: DbMotor, s: SentenciaDml, porNombre: ReadonlyMap<string, ColumnaEdicion>): BindsEnvio | string {
  const sesion = motorExplorador(motor).sesion
  const binds: BindsEnvio = []
  for (let j = 0; j < s.binds.length; j++) {
    const v = s.binds[j]
    const col = s.columnas[j] === null ? undefined : porNombre.get(s.columnas[j] as string)
    if (col && col.binaria && v !== null) {
      if (!HEX.test(v)) return `la clave binaria ${col.nombre} no llegó como hexadecimal.`
      binds.push(sesion.bindClaveBinaria(v.slice(2)))
    } else {
      const especial = col && v !== null ? sesion.bindTextoEdicion(col, v) : null
      binds.push(especial ?? v)
    }
  }
  return binds
}

/** La sentencia del cambio y, en Oracle (UPDATE/DELETE), la de la identidad sola de su fila; o el error. */
function construirSentencias(
  motor: DbMotor,
  objeto: ObjetoDml,
  identidad: DbIdentidadFila,
  cambio: DbCambioFila
): { s: SentenciaDml; identidadSola: SentenciaDml | null } | string {
  try {
    const s = sentenciaDeCambio(motor, objeto, identidad, cambio)
    let identidadSola: SentenciaDml | null = null
    // La identidad de su fila, con el MISMO constructor (y así los mismos binds y las mismas
    // columnas) que el WHERE de su DML, sin los originales: los compara el DML.
    if (esperaPorFila(motor) !== null && cambio.tipo !== 'insertar') {
      identidadSola = sentenciaDeCambio(motor, objeto, identidad, { tipo: 'borrar', clave: cambio.clave })
    }
    return { s, identidadSola }
  } catch (e) {
    return e instanceof ErrorDml ? e.message : 'No se pudo construir la sentencia.'
  }
}

/**
 * Construye con `sentenciaDeCambio` (la de la vista previa) y adapta los binds a la columna
 * que los recibe. Si uno no se puede construir, el primero que falla con su índice: nada se ha
 * enviado todavía. Los `originales` pasan antes por `originalesComparables`.
 */
export function prepararEnvio(
  motor: DbMotor,
  objeto: ObjetoDml,
  identidad: DbIdentidadFila,
  cambios: readonly DbCambioFila[],
  columnas: readonly ColumnaEdicion[]
): { ok: true; sentencias: SentenciaEnvio[] } | ({ ok: false } & FalloCambio) {
  const porNombre = columnasPorNombre(columnas)
  const sentencias: SentenciaEnvio[] = []
  for (let i = 0; i < cambios.length; i++) {
    const original = cambios[i]
    const cambio = conOriginales(original, original.tipo === 'insertar' ? undefined : originalesComparables(identidad, original.originales, columnas))
    const construidas = construirSentencias(motor, objeto, identidad, cambio)
    if (typeof construidas === 'string') return { ok: false, indice: i, mensaje: `Cambio ${i + 1}: ${construidas}` }
    const { s, identidadSola } = construidas
    const binds = adaptarBinds(motor, s, porNombre)
    if (typeof binds === 'string') return { ok: false, indice: i, mensaje: `Cambio ${i + 1}: ${binds}` }
    const sentencia: SentenciaEnvio = { tipo: cambio.tipo, sql: s.sql, binds }
    if (identidadSola) {
      const bindsB = adaptarBinds(motor, identidadSola, porNombre)
      if (typeof bindsB === 'string' || bindsB.length === 0 || bindsB.length !== identidadSola.columnas.length) {
        return { ok: false, indice: i, mensaje: `Cambio ${i + 1}: no se pudo preparar la espera del bloqueo de su fila.` }
      }
      sentencia.bloqueo = {
        tabla: `${citar(objeto.esquema)}.${citar(objeto.nombre)}`,
        columnas: identidadSola.columnas.map((c) => (c === null ? 'ROWID' : citar(c))),
        binds: bindsB
      }
    }
    sentencias.push(sentencia)
  }
  return { ok: true, sentencias }
}

/**
 * El mensaje de un COMMIT de «Enviar» que falla (`indice: -1`). Solo un error del SERVIDOR
 * garantiza que no se aplicó nada; con cualquier otro (una pérdida con el COMMIT en camino, un
 * plazo) NO se sabe, y decir «no se aplicó nada» invitaría a repetir un INSERT y duplicar filas.
 */
export function mensajeFalloCommit(detalle: string, clase: ClaseErrorTrabajador | null): string {
  if (clase === 'servidor') return `Falló al confirmar (COMMIT): ${detalle}\nNo se aplicó nada.`
  return (
    `No se sabe si el COMMIT llegó a aplicarse: ${detalle}\n` +
    'Vuelve a cargar la tabla y comprueba los datos antes de repetir el envío.'
  )
}

/** Mensaje de un cambio que no tocó EXACTAMENTE una fila (todo se revirtió). */
export function mensajeFilas(filas: number, tipo: DbCambioFila['tipo']): string {
  if (filas === 0) {
    return tipo === 'insertar'
      ? 'La fila nueva no se insertó (0 filas). No se aplicó nada.'
      : 'La fila ya no está o cambió desde que se leyó (el cambio no tocó ninguna). No se aplicó nada: vuelve a cargar la tabla.'
  }
  return `El cambio habría tocado ${filas} filas en vez de una (la clave no identifica una sola fila). No se aplicó nada.`
}
