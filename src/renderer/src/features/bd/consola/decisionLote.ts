// =============================================================================
// Lo que se decide de un lote de la consola ANTES de enviar nada: el prevuelo de solo
// lectura (todo o nada), los peligros (DML sin WHERE) y la confirmación de producción,
// en UNA decisión. Puro; la clasificación sale de `shared/sql` (la misma del main).
// Lo reexporta `estadoConsola.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import type { DbEntorno } from '../../../../../shared/db-ipc.ts'
import type { DbEstadoSesion } from '../../../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../../../shared/motores/index.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { permitidaEnSoloLectura, type PeligroSentencia } from '../../../../../shared/sql/clasificarSql.ts'
import type { Sentencia } from '../../../../../shared/sql/divisorSql.ts'
import type { Bloqueo, Peligro, Prevuelo } from './modeloConsola.ts'
import {
  commitEnBloques,
  confirmacionLoteProduccion,
  pendientesQueConfirmaDdl,
  prevueloProduccion,
  type TextosConfirmacion
} from './produccionConsola.ts'

/**
 * Todo o nada de solo lectura: si la conexión es de solo lectura y ALGUNA sentencia
 * no pasa `permitidaEnSoloLectura`, se devuelven todas las bloqueadas y no se envía
 * ninguna. Sin solo lectura, siempre `ok`.
 */
export function prevueloLote(
  sentencias: readonly Sentencia[],
  soloLectura: boolean,
  dialecto: DialectoSql
): Prevuelo {
  if (!soloLectura) return { ok: true }
  const bloqueadas: Bloqueo[] = []
  sentencias.forEach((s, indice) => {
    const p = permitidaEnSoloLectura(s, dialecto)
    if (!p.ok) bloqueadas.push({ indice, motivo: p.motivo })
  })
  return bloqueadas.length === 0 ? { ok: true } : { ok: false, bloqueadas }
}

const MAX_EXTRACTO = 80

function extracto(texto: string): string {
  const m = /\r\n|\n|\r/.exec(texto)
  const primera = (m ? texto.slice(0, m.index) : texto).trim()
  const sigue = m !== null && texto.slice(m.index).trim() !== ''
  const linea = primera + (sigue ? ' …' : '')
  return linea.length <= MAX_EXTRACTO ? linea : linea.slice(0, MAX_EXTRACTO - 1) + '…'
}

function motivoPeligro(tipo: PeligroSentencia, verbo: string): string {
  switch (tipo) {
    case 'dmlSinWhere':
      return `${verbo} sin WHERE: afecta a todas las filas de la tabla`
    case 'truncate':
      return `${verbo}: vacía la tabla entera`
    case 'dropObjeto':
      return `${verbo}: borra el objeto`
  }
}

/**
 * Sentencias que piden confirmación antes de enviar el lote. Por defecto, solo el
 * DML sin WHERE; `tipos` permite sumar TRUNCATE y DROP.
 */
export function peligros(
  sentencias: readonly Sentencia[],
  tipos: readonly PeligroSentencia[] = ['dmlSinWhere']
): Peligro[] {
  const out: Peligro[] = []
  sentencias.forEach((s, indice) => {
    if (s.peligro && tipos.indexOf(s.peligro) >= 0) {
      const verbo = s.verbo || 'La sentencia'
      out.push({ indice, tipo: s.peligro, verbo, motivo: motivoPeligro(s.peligro, verbo), extracto: extracto(s.texto) })
    }
  })
  return out
}

/**
 * Qué hacer con un lote antes de enviarlo:
 *   - 'rechazado': solo lectura y alguna sentencia escribe (el lote se marca ✗ entero).
 *   - 'confirmar': un diálogo. Con `produccion`, aceptar manda el lote con
 *     `confirmado: true` y los peligros van DENTRO de ese diálogo; sin producción, es el
 *     diálogo de los peligros.
 *   - 'libre': se envía sin preguntar.
 */
export type DecisionLote =
  | { tipo: 'rechazado'; bloqueadas: Bloqueo[] }
  | { tipo: 'confirmar'; produccion: boolean; textos: TextosConfirmacion }
  | { tipo: 'libre' }

/** Los textos del diálogo de los peligros FUERA de producción. */
export function textosPeligros(lista: readonly Peligro[], alias: string): TextosConfirmacion {
  const cuerpo = lista.map((p) => `· ${p.motivo}\n   ${p.extracto}`).join('\n')
  return {
    titulo: lista.length === 1 ? `¿Ejecutar ${lista[0].verbo} sin WHERE?` : '¿Ejecutar sentencias sin WHERE?',
    mensaje: `En ${alias}:\n\n${cuerpo}`,
    confirmar: 'Ejecutar de todos modos'
  }
}

/** Prevuelo, peligros y producción de un lote, en ese orden y en una sola decisión. */
export function decidirLote(
  sentencias: readonly Sentencia[],
  o: {
    soloLectura: boolean
    dialecto: DialectoSql
    entorno?: DbEntorno | null
    alias: string
    /**
     * La sesión de la consola (o null si aún no hay): en producción y en Oracle, un DDL
     * con cambios PENDIENTES los confirma de rebote, y la confirmación lo dice
     * (`pendientesQueConfirmaDdl`). Lo mismo un COMMIT escrito dentro de un bloque
     * (`commitEnBloques`), que en Auto no se dice.
     */
    sesion?: Pick<DbEstadoSesion, 'tx' | 'sentenciasEnTx' | 'txModo'> | null
  }
): DecisionLote {
  const pre = prevueloLote(sentencias, o.soloLectura, o.dialecto)
  if (!pre.ok) return { tipo: 'rechazado', bloqueadas: pre.bloqueadas }
  const lista = peligros(sentencias)
  const prod = prevueloProduccion(sentencias, o.entorno)
  if (prod.confirmar) {
    return {
      tipo: 'confirmar',
      produccion: true,
      textos: confirmacionLoteProduccion({
        alias: o.alias,
        total: sentencias.length,
        escrituras: prod.escrituras,
        peligros: lista,
        commitImplicito: pendientesQueConfirmaDdl(sentencias, o.dialecto, o.sesion),
        // Un COMMIT escrito dentro de un bloque confirma sin el diálogo del COMMIT (es
        // una decisión, ver el ADR): aquí solo se DICE.
        commitEnBloque: commitEnBloques(sentencias, o.dialecto, o.sesion)
      })
    }
  }
  if (lista.length > 0) return { tipo: 'confirmar', produccion: false, textos: textosPeligros(lista, o.alias) }
  return { tipo: 'libre' }
}

/**
 * ¿Pide Explicar plan los VALORES de los parámetros (`:x`, `$1`)? Solo donde el
 * planificador los usa (PostgreSQL): Oracle no hace «bind peeking» al explicar y
 * preguntarlos sería un diálogo inútil. Sale del descriptor (`sesion.explainPideValores`),
 * el mismo del que el main saca su `rellenar`; `descriptorSql` valida el dialecto.
 */
export function explicarPideValores(d: DialectoSql): boolean {
  return descriptorSql(d).sesion.explainPideValores
}
