// =============================================================================
// La espera de bloqueos de «Enviar»: el tope de espera por motor, el candado por lotes de las
// filas de los UPDATE y DELETE (Oracle), la búsqueda por bisección de la fila bloqueada y los
// mensajes. Las sentencias y los códigos son de cada motor (`motores/sesion*.ts`).
// Puro; lo reexporta `edicionRejilla.ts`.
// Decisiones: docs/decisiones/bd/rejilla-envio-bloqueos.md
// =============================================================================

import type { DbMotor } from '../../../shared/db-ipc.ts'
import type { DbCambioFila } from '../../../shared/db-explorador-ipc.ts'
import { nunca } from '../../../shared/nunca.ts'
import { MAX_ELEMENTOS_LISTA_IN } from './limites.ts'
import { motorExplorador } from './motores/index.ts'
import type { EsperaPorFila } from './motores/sesion.ts'
import type { BindsEnvio, ClaveBloqueo, LoteBloqueo, SentenciaEnvio } from './edicionRejillaTipos.ts'

/** Segundos que «Enviar» espera a que otra transacción suelte una fila. */
export const ESPERA_BLOQUEO_ENVIO_S = 10

/**
 * La espera FILA A FILA del motor (`esperaBloqueo` 'porFila': Oracle), con su candado y sus
 * códigos, o null si espera por transacción. Un `switch` que cierra con `nunca`.
 */
export function esperaPorFila(motor: DbMotor): EsperaPorFila | null {
  const espera = motorExplorador(motor).sesion.esperaBloqueo
  switch (espera.forma) {
    case 'porFila':
      return espera
    case 'porTransaccion':
    case 'porArchivo':
      return null
    default:
      return nunca(espera, 'esperaPorFila')
  }
}

/**
 * La sentencia que pone el tope de espera a TODA la transacción de «Enviar», con la PRIMERA
 * sentencia ('porTransaccion': PG; 'porArchivo': SQLite), o null si la espera va fila a fila.
 */
export function sqlEsperaBloqueoTransaccion(motor: DbMotor): string | null {
  const espera = motorExplorador(motor).sesion.esperaBloqueo
  switch (espera.forma) {
    // SQLite ('porArchivo'): la espera es de la conexión (`busy_timeout`) y se fija con la
    // primera sentencia del envío, igual que el tope de PG.
    case 'porTransaccion':
    case 'porArchivo':
      return espera.sqlTope(ESPERA_BLOQUEO_ENVIO_S)
    case 'porFila':
      return null
    default:
      return nunca(espera, 'sqlEsperaBloqueoTransaccion')
  }
}

/**
 * ¿Es `codigo` lo que el servidor del motor devuelve al vencer esa espera (Oracle, ORA-30006;
 * PG, 55P03)? El código es de la forma de esperar de cada motor (`esperaBloqueo.codigoVencida`).
 */
export function esEsperaDeBloqueo(motor: DbMotor, codigo: string | undefined): boolean {
  return codigo !== undefined && codigo === motorExplorador(motor).sesion.esperaBloqueo.codigoVencida
}

/**
 * El «ocupada» del candado SIN espera (Oracle: ORA-00054 de un `FOR UPDATE NOWAIT`, la sonda
 * de `primerCulpable`). Cualquier otro error de su sonda es de ESA fila y se cuenta tal cual.
 * Un motor que espera por transacción no tiene sondas: false.
 */
export function esOcupadaSinEspera(motor: DbMotor, codigo: string | undefined): boolean {
  const porFila = esperaPorFila(motor)
  return porFila !== null && codigo === porFila.codigoOcupada
}

/**
 * El mensaje de un cambio cuya fila no se soltó a tiempo. Todo se revirtió. En PG un INSERT
 * también puede esperar (a que otra transacción confirme o revierta una fila con la misma clave).
 */
export function mensajeFilaBloqueada(tipo: DbCambioFila['tipo']): string {
  const que =
    tipo === 'insertar'
      ? 'La fila nueva choca con otra que una transacción sin confirmar tiene bloqueada (quizá una consola tuya).'
      : 'La fila está bloqueada por otra transacción (quizá una consola tuya con cambios sin confirmar).'
  return `${que} No se aplicó nada: confirma o revierte esa transacción y vuelve a enviar.`
}

/**
 * La nota de un candado de lote que venció sin que la bisección encontrara la fila: el error
 * va en el PRIMER cambio del lote y dice que no es seguro que sea ése. `espera`: fue una
 * espera de bloqueo (lo típico: la otra transacción la soltó entretanto).
 */
export function notaSinCulpable(desde: number, hasta: number, espera: boolean): string {
  const porque = espera ? ': al buscarla, la otra transacción ya la había soltado' : ''
  return `(No se pudo saber cuál de los cambios ${desde + 1} a ${hasta + 1}${porque}.)`
}

/**
 * Filas por candado: `MAX_ELEMENTOS_LISTA_IN` valores (ORA-01795 con una columna) y, con una
 * clave compuesta, las tuplas que quepan en ese mismo número de binds.
 */
export function filasPorLote(columnas: number): number {
  return Math.max(1, Math.floor(MAX_ELEMENTOS_LISTA_IN / Math.max(1, columnas)))
}

/**
 * Cuántas filas lleva de verdad un lote de `n`: la siguiente potencia de dos, sin pasar de
 * `max`, repitiendo la última clave. Así un envío usa pocos textos SQL distintos por tabla y no
 * llena la memoria compartida del servidor de sentencias de un solo uso.
 */
export function filasConRelleno(n: number, max: number): number {
  let t = 1
  while (t < n) t *= 2
  return Math.min(t, Math.max(n, max))
}

function claveDeLote(b: ClaveBloqueo): string {
  return `${b.tabla}\u0000${b.columnas.join('\u0000')}`
}

/**
 * El candado de las filas de `indices` (que llevan todas `bloqueo`, de la misma tabla y con
 * la misma identidad): `'wait'` espera con tope; `'nowait'` falla al instante (ORA-00054) si
 * alguna está bloqueada, y es con lo que se busca cuál (`primerCulpable`). La sentencia es
 * del motor (`esperaBloqueo.sqlCandado`).
 */
export function loteDeBloqueo(
  motor: DbMotor,
  sentencias: readonly SentenciaEnvio[],
  indices: readonly number[],
  espera: 'wait' | 'nowait'
): LoteBloqueo {
  const claves = indices.map((i) => {
    const b = sentencias[i]?.bloqueo
    if (!b) throw new Error(`El cambio ${i + 1} no tiene la identidad de su fila.`)
    return b
  })
  if (claves.length === 0) throw new Error('Un candado sin filas.')
  const primera = claves[0]
  const cols = primera.columnas
  const binds: BindsEnvio = []
  const total = filasConRelleno(claves.length, filasPorLote(cols.length))
  for (let k = 0; k < total; k++) {
    const b = claves[Math.min(k, claves.length - 1)]
    if (claveDeLote(b) !== claveDeLote(primera) || b.binds.length !== cols.length) {
      throw new Error('Un candado con filas de identidades distintas.')
    }
    binds.push(...b.binds)
  }
  const porFila = esperaPorFila(motor)
  if (porFila === null) throw new Error('Un candado por fila en un motor que espera por transacción.')
  return { sql: porFila.sqlCandado(primera.tabla, cols, total, espera, ESPERA_BLOQUEO_ENVIO_S), binds, indices: [...indices] }
}

/**
 * Los candados de un envío, en orden: las filas de sus UPDATE y DELETE (los que llevan
 * `bloqueo`), troceadas en `filasPorLote`. Vacío en PG y en un envío de solo INSERT.
 */
export function lotesDeBloqueo(motor: DbMotor, sentencias: readonly SentenciaEnvio[]): LoteBloqueo[] {
  const lotes: LoteBloqueo[] = []
  let actual: number[] = []
  let clave = ''
  const cerrar = (): void => {
    if (actual.length > 0) lotes.push(loteDeBloqueo(motor, sentencias, actual, 'wait'))
    actual = []
  }
  sentencias.forEach((s, i) => {
    const b = s.bloqueo
    if (!b) return
    const k = claveDeLote(b)
    if (k !== clave || actual.length >= filasPorLote(b.columnas.length)) {
      cerrar()
      clave = k
    }
    actual.push(i)
  })
  cerrar()
  return lotes
}

/**
 * El PRIMER cambio (en el orden del envío) cuya fila hace fallar el candado, por BISECCIÓN:
 * `falla(sub)` prueba el candado de esas filas (con NOWAIT) y dice si falla. null si ninguna
 * mitad falla ya. Lo que lance `falla` (una pérdida, un Stop) sale tal cual.
 */
export async function primerCulpable(indices: readonly number[], falla: (sub: readonly number[]) => Promise<boolean>): Promise<number | null> {
  let actual = indices
  while (actual.length > 1) {
    const mitad = Math.ceil(actual.length / 2)
    const izquierda = actual.slice(0, mitad)
    if (await falla(izquierda)) {
      actual = izquierda
      continue
    }
    const derecha = actual.slice(mitad)
    if (!(await falla(derecha))) return null
    actual = derecha
  }
  return actual.length === 1 ? actual[0] : null
}
