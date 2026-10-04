// =============================================================================
// Reglas puras del gestor de sesiones: capacidades por motor, la conexión que viaja al
// trabajador, la clave del proceso y las piezas de página y de binds que comparten varias
// operaciones. Sin estado.
// Decisiones: docs/decisiones/bd/sesiones-por-motor.md
// =============================================================================

import { closeSync, openSync, readSync } from 'node:fs'
import type { DbConnection, DbMotor } from '../../../../shared/db-ipc.ts'
import type {
  DbBinds,
  DbColumnaResultado,
  DbErrorSql,
  DbPagina,
  DbRefSesion,
  DbTiempos
} from '../../../../shared/db-explorador-ipc.ts'
import {
  type CandadoSoloLectura,
  type CapacidadesSesion,
  descriptor,
  descriptorSql,
  esMotorSql
} from '../../../../shared/motores/index.ts'
import { mensajeTodaviaNo } from '../familias.ts'
import { nunca } from '../../../../shared/nunca.ts'
import type { DialectoSql } from '../../../../shared/sql/dialectosSql.ts'
import type { Sentencia } from '../../../../shared/sql/divisorSql.ts'
import type { ClaseSentencia } from '../../../../shared/sql/clasificarSql.ts'
import { type ParametroSql, parametrosSql } from '../../../../shared/sql/parametrosSql.ts'
import { bindsParaTrabajador, type BindsSalientes, validarBinds } from '../bindsConsola.ts'
import type { EfectoSesion } from '../maquinaSesion.ts'
import type { ConexionTrabajador, OpcionesEjecucion } from '../protocoloTrabajador.ts'
import { motorExplorador } from '../motores/index.ts'
import type { EsperaPorArchivo } from '../motores/sesion.ts'
import { ErrorGestor } from './errores.ts'
import type { PaginaExportada, Sesion } from './tipos.ts'

export const TIEMPOS_CERO: DbTiempos = { totalMs: 0, ejecucionMs: 0, lecturaMs: 0 }

/** Clases tras las que el esquema actual puede haber cambiado. */
export const RELEER_ESQUEMA: readonly ClaseSentencia[] = ['sesion', 'plsql', 'rutina']

/**
 * Clases tras las que se lee DBMS_OUTPUT en Oracle: las que pueden ejecutar PL/SQL
 * que escriba. Un bloque o un CALL, obvio; un DML o un DDL pueden disparar un
 * trigger con PUT_LINE (muy de código heredado); `otra` por prudencia. Se excluyen
 * `consulta` y `bloqueo` (una función con PUT_LINE en un SELECT es rara, y el viaje
 * extra se pagaría en CADA consulta por la VPN), y `tx`, `sesion` y `cliente`, que no
 * ejecutan código. En PG no hace falta decidirlo: los NOTICE llegan sin viaje.
 *
 * EL COSTE, escrito: cada sentencia de estas clases son DOS viajes (la sentencia y el
 * GET_LINES), así que un guion de N INSERT paga 2N por la VPN. Pesa donde manda el
 * RTT (DML de literales); en un DDL, lo que tarda el servidor lo tapa. SQL*Plus con
 * SERVEROUTPUT ON paga ese viaje en TODA sentencia, SELECT incluidos.
 * POR QUÉ NO SE QUITAN `dml` NI `ddl`: el buffer de
 * DBMS_OUTPUT no se vacía solo. La línea del trigger de un INSERT se quedaría en él y
 * la recogería la SIGUIENTE sentencia que sí lee (un BEGIN…END), que la enseñaría en
 * su Salida como si la hubiera escrito ella. Leer justo después es lo que atribuye la
 * salida a su sentencia; un DML también puede escribir desde una función de PL/SQL en
 * VALUES, SET o MERGE, y un DDL desde un trigger de DDL. Lo fija `test-db-oracle`
 * (trigger AFTER INSERT) y `test-gestor-sesiones` (la decisión por clase).
 * Si algún día el viaje importa, la vía no es por clase sino por LOTE: que el renderer
 * marque los DML consecutivos de un tramo y solo lea el último, a cambio de atribuir
 * la salida al tramo; es una decisión de producto, no de este módulo.
 */
export const CLASES_CON_SALIDA_ORACLE: readonly ClaseSentencia[] = ['plsql', 'rutina', 'dml', 'ddl', 'otra']

/** Filas máximas de una consulta de catálogo (el índice de nombres corta antes). */
export const MAX_FILAS_CATALOGO = 250_000

/** Versión MAYOR del servidor a partir del texto que devuelve `abrir`. */
export function versionMayor(version: string | undefined, motor: DbConnection['motor']): number {
  const m = /(\d+)/.exec(version ?? '')
  const n = m ? parseInt(m[1], 10) : NaN
  // Sin versión se toma la MÁS VIEJA soportada (`versionMinima`: la 11.2 de Oracle, cuyo
  // SQL funciona en todas; la 12 de PG).
  if (!Number.isFinite(n)) return descriptorSql(motor).sesion.versionMinima
  return n
}

/**
 * Las capacidades de la sesión del motor de un dialecto (ver `src/shared/motores/`). Se
 * pregunta con el dialecto porque es lo que cada operación tiene a mano, y es lo mismo que
 * preguntar con el motor POR CONSTRUCCIÓN: el dialecto de un motor SQL tiene su mismo id
 * (la invariante de `shared/motores/tipos.ts`).
 */
export function capacidades(d: DialectoSql): CapacidadesSesion {
  return descriptorSql(d).sesion
}

/**
 * ¿Va la lista blanca de SET de una conexión de solo lectura FUERA del candado? Con el
 * envoltorio `BEGIN READ ONLY … ROLLBACK` (PG) sí: su ROLLBACK la desharía. Con
 * `SET TRANSACTION READ ONLY` (Oracle) no: su ALTER SESSION no es transaccional. Un
 * `switch` que cierra con `nunca`: con el
 * `=== 'envoltorioRollback'` de antes, un tercer candado compilaba sin tocar esta línea y
 * dejaba el SET dentro de un envoltorio cuyo ROLLBACK lo deshacía, sin error ninguno.
 */
export function sesionFueraDelCandado(candado: CandadoSoloLectura): boolean {
  switch (candado) {
    case 'envoltorioRollback':
      return true
    // SQL Server ('clasificadorYEnvoltorio'): el SET/USE permitido va FUERA del
    // `BEGIN TRAN … ROLLBACK`, que es para lo que pueda escribir. (Un SET no es
    // transaccional en SQL Server, así que dentro también sobreviviría; fuera es más claro.)
    case 'clasificadorYEnvoltorio':
      return true
    // SQLite ('autorizador'): el candado es el autorizador, sin transacción que revertir;
    // nada que sacar.
    case 'transaccionSoloLectura':
    case 'autorizador':
      return false
    // La lista blanca es de MongoDB y Redis, que no tienen sesión SQL: aquí
    // no llega (`exigirSql`). Si llegara, se dice en voz alta en vez de elegir un lado.
    case 'listaBlanca':
      throw new ErrorGestor('interno', 'La lista blanca de solo lectura no es de una sesión SQL.')
    default:
      return nunca(candado, 'sesionFueraDelCandado')
  }
}

/**
 * La espera 'porArchivo' del motor si bloquea el ARCHIVO entero al escribir (SQLite), o null.
 * Lo mira «Enviar» antes de empezar (`sesionQueBloqueaElArchivo`). Un `switch` que cierra con
 * `nunca`: una forma nueva no compila sin decidirlo.
 */
export function esperaPorArchivo(motor: DbMotor): EsperaPorArchivo | null {
  const espera = motorExplorador(motor).sesion.esperaBloqueo
  const forma = espera.forma
  switch (forma) {
    case 'porArchivo':
      return espera as EsperaPorArchivo
    case 'porFila':
    case 'porTransaccion':
      return null
    default:
      return nunca(forma, 'esperaPorArchivo')
  }
}

/** Los primeros 32 bytes de un archivo (menos si es más corto), o null si no se leen. */
export function leerCabeceraArchivo(ruta: string): Uint8Array | null {
  let fd: number | null = null
  try {
    fd = openSync(ruta, 'r')
    const buf = Buffer.alloc(32)
    const n = readSync(fd, buf, 0, 32, 0)
    return buf.subarray(0, n)
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // ya cerrado
      }
    }
  }
}

export function claveDeRef(ref: DbRefSesion): string {
  return ref.rol === 'consola' ? `consola|${ref.perfilId}|${ref.consolaId}` : `${ref.rol}|${ref.conexionId}`
}

/**
 * La conexión que viaja al trabajador. `soloLectura` es la que IMPONE el explorador (no la
 * casilla de la conexión, que es de los agentes): con ella el trabajador de SQLite abre el
 * archivo en solo lectura; sin ella, en lectura-escritura, como lo abriría el usuario.
 */
export function aConexionTrabajador(c: DbConnection, archivo: string | null, soloLectura: boolean): ConexionTrabajador {
  const t: ConexionTrabajador = {
    id: c.id,
    alias: c.alias,
    motor: c.motor,
    host: c.host,
    port: c.port,
    user: c.user,
    readonly: soloLectura,
    driverId: c.driverId ?? null
  }
  if (c.database) t.database = c.database
  if (c.sid) t.sid = c.sid
  // Solo un motor de archivo la lleva (la de red no cambia ni un campo).
  if (archivo !== null) t.archivo = archivo
  // Los opcionales de SQL Server, solo si la conexión los tiene: una de
  // Oracle, PG o SQLite no los lleva nunca y su mensaje sale como siempre.
  if (c.instancia) t.instancia = c.instancia
  if (c.autenticacion !== undefined) t.autenticacion = c.autenticacion
  if (c.dominio) t.dominio = c.dominio
  if (c.tls !== undefined) t.tls = { cifrar: c.tls.cifrar, confiarCertificado: c.tls.confiarCertificado }
  return t
}

/**
 * Lo que solo lee el trabajador de SQL Server de una sentencia de usuario: si es una CONSULTA
 * PURA (para deducir 'pendiente' sin la DMV) y si puede CORTAR con attention al llenar la
 * página. `cortable`: además, que el attention no se lleve nada por delante (en `SELECT …⏎
 * SELECT 2` o `SELECT …⏎USE otra`, cortar el primer conjunto ABORTA el resto del lote; medido).
 * Solo en el motor que relee con OFFSET/FETCH; en los demás el mensaje sale como siempre. Un
 * `switch` con `nunca`: una forma de paginado nueva no compila sin decidirlo.
 */
export function opcionesDeLecturaEnFlujo(
  d: DialectoSql,
  consultaPura: boolean,
  cortable: boolean = consultaPura
): Pick<OpcionesEjecucion, 'consultaPura' | 'cortarAlLlenar'> {
  const forma = capacidades(d).paginado.relectura
  switch (forma) {
    case 'offsetFetch':
      return { consultaPura, cortarAlLlenar: consultaPura && cortable }
    case 'cursor':
    case 'rownum':
    case 'limitOffset':
    case 'keyset':
      return {}
    default:
      return nunca(forma, 'opcionesDeLecturaEnFlujo')
  }
}

/**
 * El aviso de una transacción que el SERVIDOR revirtió sin que se pidiera (SQL
 * Server: un error de conversión, un interbloqueo, XACT_ABORT; `revertidaPorServidor`).
 */
export function avisoRevertida(d: DialectoSql, r: { codigo?: string }): string {
  return `${descriptor(d).etiqueta} revirtió la transacción${r.codigo ? ` (error ${r.codigo})` : ''}: los cambios sin confirmar se perdieron.`
}

/**
 * La clave del proceso en el que corre `s` (ver `Proceso.clave`): el propio de la consola en
 * un motor con `procesoPorSesion` (SQLite: su Stop es matar el proceso, y matar el de la
 * conexión se llevaría el árbol y las demás consolas), el de la conexión en todo lo demás.
 */
export function claveProceso(con: DbConnection, s: Pick<Sesion, 'rol' | 'clave'>): string {
  return procesoPorSesion(con) && s.rol === 'consola' ? `${con.id}|${s.clave}` : con.id
}

/**
 * ¿Tiene el motor de `con` un proceso por consola (`sesion.procesoPorSesion`,
 * SQLite)? Solo existe en SQL: con MongoDB o Redis, que llegan aquí por los canales COMUNES
 * (FORZAR, CANCELAR) y no tienen sesiones en este gestor, false en vez de lanzar.
 */
export function procesoPorSesion(con: DbConnection): boolean {
  return esMotorSql(con.motor) && descriptorSql(con.motor).sesion.procesoPorSesion
}

/**
 * Todo lo de este gestor es SQL (sesiones, transacciones, el trabajador de
 * `tdb`): una conexión de otra familia se rechaza con `motivo: 'driver'` y «Todavía no se
 * puede conectar a <etiqueta> desde esta versión.» (`familias.ts`), antes de lanzar nada.
 */
export function exigirSql(con: DbConnection): void {
  if (!esMotorSql(con.motor)) throw new ErrorGestor('driver', mensajeTodaviaNo(con.motor))
}

export function rechazoDe(efectos: EfectoSesion[]): Extract<EfectoSesion, { tipo: 'rechazar' }> | null {
  for (const e of efectos) if (e.tipo === 'rechazar') return e
  return null
}

export function efectoTx(efectos: EfectoSesion[]): Extract<EfectoSesion, { tipo: 'tx' }> | null {
  for (const e of efectos) if (e.tipo === 'tx') return e
  return null
}

export function abierta(s: Sesion): boolean {
  const f = s.estado.fase
  return f === 'lista' || f === 'ocupada' || f === 'abriendo'
}

/** ¿Está `s` lista con su proceso vivo y admitiendo sesiones? (Si no, hay que (re)abrirla.) */
export function listaConProcesoVivo(s: Sesion): boolean {
  const p0 = s.proceso
  return s.estado.fase === 'lista' && p0 !== null && p0.trabajador.vivo && !p0.salido && !p0.retirado
}

/**
 * Resuelve tras `ms` sin retener el proceso (`unref`): es un plazo de carrera, no
 * trabajo pendiente. Exportada para el controlador (los plazos de la salida), que
 * tenía una copia idéntica.
 */
export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    if (typeof t === 'object' && t && 'unref' in t) (t as { unref: () => void }).unref()
  })
}

export function pagina(
  r: { filasJson: string; hayMas: boolean; recortes?: Array<[number, number, number]> },
  desde: number,
  reejecutada = false
): DbPagina {
  const pagina: DbPagina = { filasJson: r.filasJson, desde, hayMas: r.hayMas }
  if (r.recortes && r.recortes.length) pagina.recortes = r.recortes
  if (reejecutada) pagina.reejecutada = true
  return pagina
}

/**
 * Los binds de una sentencia para el trabajador (ver `bindsConsola.ts`): valida la
 * forma de lo que mandó el renderer, saca los parámetros del texto que se ENVÍA y
 * rechaza con `parametros` si falta alguno. `rellenar`: los que falten van como NULL.
 */
export function bindsDeSentencia(
  st: Sentencia,
  d: DialectoSql,
  crudos: DbBinds | undefined,
  rellenar = false
): { ok: true; binds: BindsSalientes | undefined; params: ParametroSql[]; aviso?: string } | { ok: false; error: DbErrorSql } {
  const v = validarBinds(crudos)
  if (!v.ok) return { ok: false, error: { motivo: 'parametros', mensaje: v.mensaje } }
  const params = parametrosSql(st.texto, d)
  const b = bindsParaTrabajador(params, v.binds, d, rellenar, st.texto)
  if (!b.ok) {
    const error: DbErrorSql = { motivo: 'parametros', mensaje: b.mensaje }
    // Sin claves que faltan (un `$n` por encima del tope de PG) no hay nada que pedir.
    if (b.faltan.length > 0) error.parametros = b.faltan
    return { ok: false, error }
  }
  return b.aviso === undefined ? { ok: true, binds: b.binds, params } : { ok: true, binds: b.binds, params, aviso: b.aviso }
}

export function paginaExportada(
  columnas: DbColumnaResultado[],
  filasJson: string,
  recortes: Array<[number, number, number]> | undefined
): PaginaExportada {
  const p: PaginaExportada = { columnas, filasJson }
  if (recortes && recortes.length > 0) p.recortes = recortes
  return p
}
