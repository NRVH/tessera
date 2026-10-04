// =============================================================================
// SQL que el main manda a la sesión de una CONSOLA fuera de las sentencias del usuario: el
// esquema elegido en su selector (fijarlo, releerlo, cuándo reaplicarlo u olvidarlo) y los
// errores de compilación de un CREATE. Puro, con las reglas de `catalogoSql.ts` (binds e
// identificadores citados); el SQL de cada motor está en `motores/sesion*.ts`.
// Decisiones: docs/decisiones/bd/sesiones-esquema-de-consola.md
// =============================================================================

import type { DbErrorCompilacion } from '../../../shared/db-explorador-ipc.ts'
import { descriptorSql } from '../../../shared/motores/index.ts'
import type { DialectoSql } from '../../../shared/sql/dialectosSql.ts'
import type { Sentencia } from '../../../shared/sql/divisorSql.ts'
import { offsetDeErrorCompilacion } from '../../../shared/sql/posicionErrorSql.ts'
import { motorExplorador } from './motores/index.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './motores/tipos.ts'

// --- Esquema de la consola ------------------------------------------------------------

/** Valor de `search_path` para un esquema elegido (ver la cabecera). Solo existe en PG. */
export { searchPathDe } from './motores/sesionPostgres.ts'

/**
 * La sentencia que fija el esquema de una sesión de consola. `esquema` null = volver
 * al de la conexión (`esquemaConexion`, el que tenía la sesión al abrirse; en Oracle
 * hace falta, en PG no). null si no hay a qué volver. El SQL es de cada motor
 * (`motores/sesion*.ts`).
 */
export function sqlFijarEsquema(
  d: DialectoSql,
  esquema: string | null,
  esquemaConexion: string | null
): ConsultaCatalogo | null {
  return motorExplorador(d).sesion.sqlFijarEsquema(esquema, esquemaConexion)
}

/** Mensaje de la Salida cuando el esquema guardado ya no existe al reabrir. */
export function avisoEsquemaPerdido(esquema: string, actual: string | null): string {
  return `El esquema ${esquema} de esta consola ya no existe: vuelve al de la conexión${actual ? ` (${actual})` : ''}.`
}

/** La sentencia que solo LEE el esquema actual de la sesión (sin cambiarlo). */
export function sqlLeerEsquema(d: DialectoSql): ConsultaCatalogo {
  return motorExplorador(d).sesion.sqlLeerEsquema()
}

/**
 * PG, tras una sentencia de clase `tx`: ¿hay que volver a aplicar el esquema elegido?
 * Solo si una REVERSIÓN lo deshizo: la sesión estaba en el elegido ANTES (`antes`) y
 * DESPUÉS ya no (`despues`; undefined = no se pudo releer, y reaplicar lo que ya
 * estaba no cambia nada). Si antes estaba en otro, lo movió un SET del usuario y
 * manda él (ver la cabecera). Sin elegido, nunca.
 */
export function reaplicarTrasTx(antes: string | null, despues: string | null | undefined, elegido: string | null): boolean {
  return elegido !== null && antes === elegido && despues !== elegido
}

/** Cómo terminó el intento de volver a aplicar el esquema elegido al (re)abrir. */
export type IntentoReaplicar =
  /** El ALTER / set_config no lanzó; `leido` es lo que devolvió la relectura (null = nada). */
  | { ok: true; leido: string | null }
  /** Lanzó; `codigo` es el del error del trabajador (null si no lo hay). */
  | { ok: false; codigo: string | null }

/** Qué hace el gestor con ese intento (ver `reaplicarEsquema` en `sesiones/esquemaConsola.ts`). */
export type TrasReaplicar =
  /** Quedó aplicado: el estado de la sesión dice `esquema`. */
  | { tipo: 'aplicado'; esquema: string }
  /** No se sabe (pérdida, plazo, red, la sesión dejó de abrirse): se conserva, sin aviso. */
  | { tipo: 'conservar' }
  /** PG sin relectura: vuelve al de la conexión EN ESTA SESIÓN, pero no lo olvida ni avisa. */
  | { tipo: 'volver' }
  /** Ya no existe: vuelve al de la conexión, se olvida en el índice y se avisa. */
  | { tipo: 'degradar' }

/**
 * Decide qué hacer tras volver a aplicar el esquema `elegido` al (re)abrir una consola.
 * Solo DEGRADA ante la señal real de que ya no existe (ver la cabecera):
 *   - Si fijar el esquema VALIDA (`fijarEsquemaValida`, Oracle): el código que dice «no
 *     existe» (`esquemaInexistente`, ORA-01435). Un ALTER que no lanzó está aplicado
 *     aunque la relectura no llegara; cualquier otro error se conserva.
 *   - Si no (PG): un error nunca significa «no existe» (set_config acepta cualquier
 *     nombre). Si no lanzó y `current_schema()` devolvió OTRO esquema, lo saltó: no
 *     existe (o no hay USAGE). Si devolvió null no se distingue una relectura fallida de
 *     un search_path sin ningún esquema utilizable: se vuelve sin olvidar.
 * `sigueAbriendo`: la sesión sigue en `abriendo` (si no, se perdió mientras tanto y lo
 * leído no vale).
 */
export function trasReaplicarEsquema(
  d: DialectoSql,
  elegido: string,
  intento: IntentoReaplicar,
  sigueAbriendo: boolean
): TrasReaplicar {
  if (!intento.ok) return motorExplorador(d).sesion.esquemaInexistente(intento.codigo) ? { tipo: 'degradar' } : { tipo: 'conservar' }
  if (descriptorSql(d).sesion.fijarEsquemaValida) return { tipo: 'aplicado', esquema: intento.leido ?? elegido }
  if (intento.leido === elegido) return { tipo: 'aplicado', esquema: elegido }
  if (!sigueAbriendo) return { tipo: 'conservar' }
  if (intento.leido === null) return { tipo: 'volver' }
  return { tipo: 'degradar' }
}

// --- Errores de compilación de lo que crea la consola ------------------------------------

/**
 * La consulta de los errores de compilación que el servidor guarda de la unidad que acaba
 * de crear `st`, o null si no hay nada que leer (y entonces no se lee: es la única
 * pregunta). Es del MOTOR (`sqlErroresCompilacion` de `motores/sesion*.ts`: Oracle,
 * ALL_ERRORS tras un CREATE de PL/SQL; PG, nunca). Filas: `[line, position, text,
 * attribute]`.
 */
export function sqlErroresCompilacion(st: Sentencia, d: DialectoSql): ConsultaCatalogo | null {
  return motorExplorador(d).sesion.sqlErroresCompilacion(st)
}

function numero(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/**
 * Filas de `sqlErroresCompilacion` (`[línea, columna, texto, atributo]`, el contrato de
 * todo motor que los lea) -> `DbErrorCompilacion[]`, con la posición en el texto enviado.
 */
export function mapearErroresCompilacion(st: Sentencia, filas: readonly FilaCatalogo[]): DbErrorCompilacion[] {
  return filas.map((f) => {
    const linea = numero(f[0])
    const columna = numero(f[1])
    const e: DbErrorCompilacion = {
      linea,
      columna,
      mensaje: String(f[2] ?? '').replace(/\s+$/, ''),
      esAviso: String(f[3] ?? '').trim().toUpperCase() === 'WARNING'
    }
    const pos = offsetDeErrorCompilacion(st, linea, columna)
    if (pos !== null) e.posicion = pos
    return e
  })
}
