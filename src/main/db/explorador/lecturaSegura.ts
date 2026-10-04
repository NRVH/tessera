// =============================================================================
// Lógica pura del humo de solo lectura contra una base real (`test-db-oracle-lectura.mts`): encontrar la
// conexión en el registro, forzarla a solo lectura, sacar su contraseña del puente, taparla en la salida
// y vetar cualquier petición al trabajador que pudiera escribir o bloquear. Vive aparte porque el humo
// solo corre por VPN en la máquina del usuario; lo que decide sin red lo fija `test-lectura-segura.mts`.
// Decisiones: docs/decisiones/bd/conexiones-humo-de-solo-lectura.md
// =============================================================================

import { envVarDestino, envVarSecreto, type DbConnection } from '../../../shared/db-ipc.ts'
import { huellaDestino, type DestinoBd } from '../huellaDestino.ts'
import { esObjeto } from '../../util/valores.ts'
import { esMotor } from '../../../shared/motores/index.ts'
import {
  MOTOR_ILEGIBLE,
  comparteId,
  crudoDeConocida,
  nombreDeEntrada,
  perfilDeEntrada,
  type Registro
} from '../registroConexiones.ts'
import type { PeticionSinId } from './protocoloTrabajador.ts'
import { sqlDdlOracle } from './ddlCatalogo.ts'
import { extraerExplicarOracle } from './planSql.ts'
import { PREFIJO_SESION_EDICION } from './edicionRejilla.ts'

/** Versión del protocolo del puente. DEBE coincidir con `PROTOCOLO` de `dbBridge.ts`. */
export const PROTOCOLO_PUENTE = 1

/** Por debajo de esta longitud la contraseña no se tapa: se destrozaría la salida por una que Oracle ni admite. */
export const MIN_TAPAR = 4

/** Rango de filas, según estadísticas, de la tabla de la pestaña de datos. */
export const FILAS_TABLA_MIN = 250
export const FILAS_TABLA_MAX = 100_000
/** Candidatas que devuelve `sqlTablasModestas` (se cruzan con el listado del árbol). */
export const CANDIDATAS_TABLA = 20

function esTexto(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

// --- Registro de conexiones ---------------------------------------------------------------

export type BusquedaConexion = { ok: true; entrada: Record<string, unknown> } | { ok: false; mensaje: string }

interface Candidata {
  crudo: Record<string, unknown>
  conocida: boolean
  idRepetido: boolean
  suPerfil: string | null
}

/** Las entradas del registro que son objetos (como `tdb`), solo las del perfil si se sabe cuál es. */
function candidatasDe(reg: Registro, perfil: string | null): Candidata[] {
  const candidatas: Candidata[] = []
  for (const e of reg.entradas) {
    const suPerfil = perfilDeEntrada(e)
    if (perfil && suPerfil !== perfil) continue
    if (e.tipo === 'conocida') candidatas.push({ crudo: crudoDeConocida(e), conocida: true, idRepetido: false, suPerfil })
    else if (esObjeto(e.crudo)) candidatas.push({ crudo: e.crudo, conocida: false, idRepetido: e.idRepetido === true, suPerfil })
  }
  return candidatas
}

/** Con quién comparte el id una copia por id repetido, dicho como en la interfaz y en `tdb`. */
function conQuienComparte(reg: Registro, hallada: Candidata): string {
  // Una copia por id repetido es de forma conocida, así que trae id y perfil de texto.
  const comparte = comparteId(reg, String(hallada.crudo.id), hallada.suPerfil ?? '')
  if (comparte.tipo === 'conexion') return `«${comparte.alias}»`
  return comparte.tipo === 'otroPerfil' ? 'una conexión de otro perfil' : 'otra conexión'
}

/** Por qué no se puede usar una entrada que casó con el alias pero no es una conocida. */
function mensajeDeAjena(reg: Registro, hallada: Candidata): string {
  const nombre = nombreDeEntrada(hallada.crudo)
  if (hallada.idRepetido) {
    return (
      `«${nombre}» comparte su identificador con ${conQuienComparte(reg, hallada)}: esta versión no puede distinguirlas y usa la primera ` +
      'del registro. Tessera la conserva tal cual; elimínala desde Tessera si sobra.'
    )
  }
  const motor = hallada.crudo.motor
  // `esMotor` y no un `includes`: es la misma pregunta que se hacen el main y `tdb`.
  if (!esMotor(motor)) {
    const legible = typeof motor === 'string' && motor.trim() !== '' ? motor : MOTOR_ILEGIBLE
    return `«${nombre}» es de un motor (${legible}) que esta versión de Tessera no conoce: actualiza Tessera para usarla.`
  }
  return (
    `«${nombre}» está guardada de una forma que esta versión no reconoce. Puede venir de una versión más ` +
    'nueva de Tessera (actualiza para usarla) o de una edición a mano del archivo; Tessera la conserva tal cual.'
  )
}

/**
 * La conexión `alias` del registro, como la busca `tdb`: sin distinguir mayúsculas ni espacios sobrantes,
 * o por su id, y solo entre las del perfil de la terminal si se sabe cuál es. Con el registro bloqueado o
 * una entrada que esta versión no sabe usar, falla diciendo su causa; «Disponibles» nombra solo las usables.
 */
export function buscarEnRegistro(reg: Registro, alias: string, perfil: string | null): BusquedaConexion {
  if (reg.formatoAjeno) return { ok: false, mensaje: reg.aviso }
  const candidatas = candidatasDe(reg, perfil)
  const objetivo = alias.trim().toLowerCase()
  const hallada =
    candidatas.find(({ crudo: c }) => typeof c.alias === 'string' && c.alias.trim().toLowerCase() === objetivo) ??
    candidatas.find(({ crudo: c }) => typeof c.id === 'string' && c.id.toLowerCase() === objetivo)
  if (hallada?.conocida) return { ok: true, entrada: hallada.crudo }
  if (hallada) return { ok: false, mensaje: mensajeDeAjena(reg, hallada) }
  const usables = candidatas.filter((c) => c.conocida).map((c) => `«${nombreDeEntrada(c.crudo)}»`)
  const otras = candidatas.length - usables.length
  const donde = perfil ? 'en el perfil de esta terminal' : 'en el registro'
  return {
    ok: false,
    mensaje:
      `No hay ninguna conexión «${alias.trim()}» ${donde}. Disponibles: ${usables.join(', ') || '(ninguna)'}.` +
      (otras > 0 ? ` Y ${otras} que esta versión no sabe usar.` : '')
  }
}

export type CopiaConexion =
  | { ok: true; conexion: DbConnection; eraEscritura: boolean }
  | { ok: false; mensaje: string }

/** Lo que hace falta para conectar con una conexión del registro. */
type DatosDeConexion = { id: string; profileId: string; alias: string; host: string; user: string; port: number }

/** ¿Trae la entrada id, perfil, alias, host, usuario y un puerto válido? */
function tieneDatosDeConexion(e: Record<string, unknown>): e is Record<string, unknown> & DatosDeConexion {
  const port = e.port
  return (
    esTexto(e.id) &&
    esTexto(e.profileId) &&
    esTexto(e.alias) &&
    esTexto(e.host) &&
    esTexto(e.user) &&
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535
  )
}

/**
 * Copia de la entrada del registro para el gestor, siempre en solo lectura y solo con los campos que
 * hacen falta para conectar: ni el secreto cifrado, ni los esquemas seleccionados, ni la introspección.
 */
export function copiaSoloLectura(e: Record<string, unknown>): CopiaConexion {
  const alias = String(e.alias ?? e.id ?? '?')
  if (e.motor !== 'oracle') { // motor-fijo: este smoke es solo de Oracle (la base remota de solo lectura es una 11.2)
    return { ok: false, mensaje: `«${alias}» es de ${String(e.motor)}: este smoke es solo de Oracle.` }
  }
  if (!tieneDatosDeConexion(e)) {
    return { ok: false, mensaje: `La conexión «${alias}» del registro está incompleta (id, perfil, host, puerto o usuario).` }
  }
  const port = e.port
  const database = esTexto(e.database) ? e.database : undefined
  const sid = esTexto(e.sid) ? e.sid : undefined
  if (!database && !sid) return { ok: false, mensaje: `La conexión «${alias}» no tiene ni servicio ni SID.` }
  const conexion: DbConnection = {
    id: e.id,
    profileId: e.profileId,
    alias: e.alias,
    motor: 'oracle',
    host: e.host,
    port,
    user: e.user,
    tieneSecreto: true,
    readonly: true,
    driverId: esTexto(e.driverId) ? e.driverId : null
  }
  // Los dos, tal cual vengan: el registro los declara excluyentes y quien decide
  // cuál usar es `oracle.cjs`, no el smoke.
  if (database) conexion.database = database
  if (sid) conexion.sid = sid
  return { ok: true, conexion, eraEscritura: e.readonly !== true }
}

// --- Puente de Tessera --------------------------------------------------------------------

export type EstadoPuente =
  | { tipo: 'sinPuente' }
  | { tipo: 'noResponde' }
  | { tipo: 'rechazado'; error: string }
  | {
      tipo: 'ok'
      scope: string[]
      secretos: Record<string, string>
      /** La huella del destino de cada secreto (`RespuestaResolve.huellas`); `null` si no vino. */
      huellas: Record<string, string> | null
    }

/** La línea que se escribe en el pipe: la MISMA que manda `pedirAlPuente` de `tdbPuente.cjs`. */
export function peticionPuente(token: string): string {
  return JSON.stringify({ v: PROTOCOLO_PUENTE, token, op: 'resolve' }) + '\n'
}

/**
 * Lo que contestó el puente (todo lo leído hasta el `end`). Como `tdb`, se queda con
 * la ÚLTIMA línea no vacía. Una respuesta ilegible cuenta como «no responde»: para
 * quien lo lanza, el remedio es el mismo.
 */
export function interpretarRespuestaPuente(texto: string): EstadoPuente {
  const lineas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const ultima = lineas[lineas.length - 1]
  if (ultima === undefined) return { tipo: 'noResponde' }
  let r: unknown
  try {
    r = JSON.parse(ultima)
  } catch {
    return { tipo: 'noResponde' }
  }
  if (!esObjeto(r)) return { tipo: 'noResponde' }
  if (r.ok === true) {
    const secretos: Record<string, string> = {}
    if (esObjeto(r.secretos)) {
      for (const [k, v] of Object.entries(r.secretos)) if (typeof v === 'string') secretos[k] = v
    }
    const scope = Array.isArray(r.scope) ? r.scope.filter((x): x is string => typeof x === 'string') : []
    let huellas: Record<string, string> | null = null
    if (esObjeto(r.huellas)) {
      huellas = {}
      for (const [k, v] of Object.entries(r.huellas)) if (typeof v === 'string') huellas[k] = v
    }
    return { tipo: 'ok', scope, secretos, huellas }
  }
  if (r.ok === false) return { tipo: 'rechazado', error: typeof r.error === 'string' ? r.error : 'sin motivo' }
  return { tipo: 'noResponde' }
}

export type ResolucionSecreto =
  | { ok: true; secreto: string; origen: 'puente' | 'entorno' }
  | { ok: false; mensaje: string }

/** El secreto que sirvió el puente (`ok`), solo si su huella es la de la entrada del registro. */
function secretoDelPuente(id: string, puente: Extract<EstadoPuente, { tipo: 'ok' }>, huella: string): ResolucionSecreto {
  const s = Object.prototype.hasOwnProperty.call(puente.secretos, id) ? puente.secretos[id] : undefined
  if (s) {
    // Como `tdb`: sin la huella de lo que sirve el puente, o con otra, no se usa.
    if (puente.huellas !== null && puente.huellas[id] === huella) return { ok: true, secreto: s, origen: 'puente' }
    return {
      ok: false,
      mensaje:
        'La conexión del registro no es la que tiene cargada Tessera (cambió mientras se leía, o se editó ' +
        'db-connections.json a mano con Tessera abierta), así que no se le manda su contraseña. Vuelve a ' +
        'lanzar; si sigue igual, reinicia Tessera.'
    }
  }
  if (puente.scope.indexOf(id) < 0) {
    return {
      ok: false,
      mensaje:
        'La base NO está montada en el proyecto de esta terminal. Márcala en el selector de bases de ese ' +
        'proyecto (aplica al momento, no hace falta reiniciar) y vuelve a lanzar.'
    }
  }
  return {
    ok: false,
    mensaje:
      'La base está montada, pero Tessera no tiene su contraseña (no se guardó, o se guardó en otro ' +
      'equipo y aquí no se puede descifrar). Escríbela en la conexión, pulsa «Probar» y vuelve a lanzar.'
  }
}

/**
 * El secreto del entorno, sin puente. Sin huella se acepta (el uso documentado: puesta a mano contra una
 * base de pruebas); con ella, la puso una terminal de Tessera y tiene que ser la de esta entrada.
 */
function secretoDelEntorno(
  id: string,
  entorno: Readonly<Record<string, string | undefined>>,
  huella: string
): ResolucionSecreto {
  const s = entorno[envVarSecreto(id)]
  const suHuella = entorno[envVarDestino(id)]
  if (s && suHuella !== undefined && suHuella !== huella) {
    return {
      ok: false,
      mensaje:
        `La contraseña del entorno es de otro destino: la conexión cambió desde que se abrió la terminal (${envVarDestino(id)} ` +
        'no casa con la del registro). Recarga la terminal y vuelve a lanzar; si sigue igual, reinicia Tessera ' +
        '(el registro se editó a mano con la app abierta y la memoria no se relee); si la contraseña la pusiste a ' +
        'mano, quita también esa variable.'
    }
  }
  if (s) return { ok: true, secreto: s, origen: 'entorno' }
  return {
    ok: false,
    mensaje: 'Esta terminal no lleva el puente de Tessera (TESSERA_DB_PIPE y TESSERA_DB_SESSION) ni la contraseña en el entorno.'
  }
}

/**
 * La contraseña de la conexión `id`, o por qué no la hay y qué hacer, por el mismo camino que `tdb`: la
 * sirve el puente y solo se usa contra la entrada para la que se emitió (su huella).
 *
 * @param destino la entrada del REGISTRO tal como se leyó (no la copia para el gestor): la huella tiene
 *                que salir de lo mismo que lee el main.
 */
export function resolverSecreto(
  id: string,
  puente: EstadoPuente,
  entorno: Readonly<Record<string, string | undefined>>,
  destino: DestinoBd
): ResolucionSecreto {
  const huella = huellaDestino(destino)
  switch (puente.tipo) {
    case 'ok':
      return secretoDelPuente(id, puente, huella)
    case 'rechazado':
      return {
        ok: false,
        mensaje:
          `El puente de Tessera rechazó el token de esta terminal (${puente.error}): es de una sesión anterior. ` +
          'Pulsa «Recargar» en la terminal y vuelve a lanzar.'
      }
    case 'noResponde':
      return {
        ok: false,
        mensaje:
          'El puente de Tessera no responde (¿Tessera cerrada, o la terminal es de otra instancia?). ' +
          'Lánzalo desde una terminal de la Tessera abierta ahora; si sigue igual, reinicia Tessera.'
      }
    case 'sinPuente':
      return secretoDelEntorno(id, entorno, huella)
  }
}

// --- Salida ---------------------------------------------------------------------------------

/**
 * `texto` con la contraseña (y su forma escapada en JSON) cambiada por `***`, y si
 * hubo que hacerlo. Con menos de `MIN_TAPAR` caracteres no se toca nada.
 */
export function taparSecreto(texto: string, secreto: string): { texto: string; tapado: boolean } {
  if (secreto.length < MIN_TAPAR) return { texto, tapado: false }
  let t = texto
  let tapado = false
  for (const forma of [secreto, JSON.stringify(secreto).slice(1, -1)]) {
    if (forma && t.includes(forma)) {
      t = t.split(forma).join('***')
      tapado = true
    }
  }
  return { texto: t, tapado }
}

/** `1234` -> `1.23 s`; `85` -> `85 ms`; `125000` -> `2 min 5 s`. */
export function formatearMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)} min ${total % 60} s`
}

// --- Centinela ------------------------------------------------------------------------------

/**
 * Primera palabra del SQL, en mayúsculas, saltando blancos, comentarios (`--` y
 * `/* … *\/`) y paréntesis de apertura. Vacía si no hay ninguna o un comentario
 * queda sin cerrar.
 */
export function primeraPalabra(sql: string): string {
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '(') {
      i++
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      const fin = sql.indexOf('\n', i)
      if (fin < 0) return ''
      i = fin + 1
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      const fin = sql.indexOf('*/', i + 2)
      if (fin < 0) return ''
      i = fin + 2
      continue
    }
    break
  }
  const m = /^[A-Za-z_]+/.exec(sql.slice(i))
  return m ? m[0].toUpperCase() : ''
}

/**
 * Las tres únicas sentencias que no son SELECT/WITH y aun así pasan, cada una por igualdad exacta con lo
 * que genera el producto: el bloque de «Ver DDL» (`sqlDdlOracle`), `ALTER SESSION SET CURRENT_SCHEMA = "X"`
 * y el `EXPLAIN PLAN` de `sqlExplicarOracle`, este solo si lo que va detrás del FOR pasaría como lectura y,
 * en `vetarPeticion`, sin autocommit para que sus filas de PLAN_TABLE se reviertan.
 */
const BLOQUE_DDL = sqlDdlOracle({ esquema: 'X', nombre: 'X', tipo: 'tabla' }).sql
const CAMBIO_ESQUEMA = /^ALTER SESSION SET CURRENT_SCHEMA = "(?:[^"]|"")+"$/

/** Por qué este SQL no puede salir hacia la base, o null si es una lectura (lista BLANCA). */
export function vetarSql(sql: string): string | null {
  if (sql === BLOQUE_DDL || CAMBIO_ESQUEMA.test(sql)) return null
  const explain = extraerExplicarOracle(sql)
  if (explain) {
    const dentro = vetarLectura(explain.sentencia)
    return dentro ? `un EXPLAIN PLAN de ${dentro}` : null
  }
  return vetarLectura(sql)
}

/** La lista blanca propiamente dicha: SELECT o WITH, sin PL/SQL dentro, sin bloquear filas. */
function vetarLectura(sql: string): string | null {
  const palabra = primeraPalabra(sql)
  if (palabra !== 'SELECT' && palabra !== 'WITH') {
    return `una sentencia que empieza por «${palabra || '(nada)'}»: solo pasan SELECT y WITH`
  }
  if (/\bWITH\s+(FUNCTION|PROCEDURE)\b/i.test(sql)) return 'un WITH con PL/SQL dentro'
  if (/\bFOR\s+UPDATE\b/i.test(sql)) return 'un SELECT … FOR UPDATE, que bloquea filas'
  if (/\bDBMS_LOCK\b/i.test(sql)) return 'una llamada a DBMS_LOCK'
  return null
}

/**
 * Por qué esta petición al trabajador no puede salir, o null si puede. Ver la
 * ADR: es el segundo candado, independiente del producto.
 */
export function vetarPeticion(p: PeticionSinId): string | null {
  switch (p.op) {
    case 'abrir':
      // La sesión de «Enviar» solo existe para ESCRIBIR: en una conexión de solo
      // lectura el main la rechaza antes de abrirla. Si llegara aquí, es el canario.
      if (p.sesion.startsWith(PREFIJO_SESION_EDICION)) return 'abrir la sesión de «Enviar» de la rejilla (escribe)'
      return p.conexion.readonly === true ? null : 'abrir una sesión que no es de solo lectura'
    case 'ejecutar': {
      // El EXPLAIN PLAN del producto es la ÚNICA sentencia de usuario que va sin el
      // candado (dentro de un SET TRANSACTION READ ONLY falla: ORA-00604, medido en
      // 11.2 y 21c), y tiene que ir sin autocommit: sus filas de PLAN_TABLE se revierten.
      const explain = extraerExplicarOracle(p.sql) !== null
      if (explain && p.opciones.txManual !== true) return 'un EXPLAIN PLAN con autocommit (confirmaría las filas del plan)'
      if (p.opciones.proposito === 'usuario' && p.opciones.candadoRO !== true && !explain) {
        return 'una sentencia de usuario sin el candado de solo lectura'
      }
      return vetarSql(p.sql)
    }
    case 'tx':
      return p.accion === 'commit' ? 'un COMMIT' : null
    case 'autoCommit':
      // El main no la manda hoy (ver `protocoloTrabajador.ts`): si aparece, algo
      // cambió y conviene enterarse antes de que llegue a la base.
      return 'un cambio de modo de transacción (autoCommit), que el main no manda'
    default:
      return null
  }
}

// --- Tabla de la pestaña de datos -----------------------------------------------------------

export interface ConsultaSimple {
  sql: string
  binds: Record<string, string | number>
}

/**
 * Tablas del esquema con un tamaño moderado SEGÚN ESTADÍSTICAS (`num_rows`), de menor
 * a mayor y con tope de candidatas. Lectura de diccionario con binds: es la única
 * consulta del smoke que no sale del producto, y existe para que Contar no sea un
 * COUNT(*) sobre una tabla enorme. Pasa por `vetarSql` como todas.
 *
 * De ALL_TAB_STATISTICS y no de ALL_TABLES: medido contra un XE 11.2, leer `num_rows`
 * de ALL_TABLES costaba ~2 s en cada llamada (la vista arrastra todas sus columnas y
 * la 11g no la poda) y ALL_TAB_STATISTICS contesta en ~1 ms con el mismo dato. Lo que
 * no sea una tabla del árbol (temporales, anidadas, de la papelera) lo descarta
 * `elegirTabla` al cruzar con el listado, que ya pasa por los filtros del producto.
 */
export function sqlTablasModestas(esquema: string): ConsultaSimple {
  return {
    sql: [
      'SELECT table_name, num_rows FROM (',
      '  SELECT table_name, num_rows FROM all_tab_statistics',
      "   WHERE owner = :esq AND object_type = 'TABLE' AND num_rows BETWEEN :minimo AND :maximo",
      '   ORDER BY num_rows, table_name',
      `) WHERE ROWNUM <= ${CANDIDATAS_TABLA}`
    ].join('\n'),
    binds: { esq: esquema, minimo: FILAS_TABLA_MIN, maximo: FILAS_TABLA_MAX }
  }
}

export type EleccionTabla = { ok: true; nombre: string; motivo: string } | { ok: false; mensaje: string }

/**
 * La tabla de la pestaña de datos: la pedida por argumento (si está en el listado del
 * árbol), o la primera candidata de `sqlTablasModestas` que también esté en él (así
 * pasa por los mismos filtros que el árbol), o la primera del listado.
 */
export function elegirTabla(
  listado: readonly string[],
  candidatas: readonly (readonly unknown[])[],
  pedida: string | null
): EleccionTabla {
  const p = (pedida ?? '').trim()
  if (p) {
    const hallada = listado.find((n) => n === p) ?? listado.find((n) => n.toUpperCase() === p.toUpperCase())
    if (hallada) return { ok: true, nombre: hallada, motivo: 'la pedida por argumento' }
    return { ok: false, mensaje: `«${p}» no está entre las ${listado.length} tablas del esquema por defecto.` }
  }
  if (listado.length === 0) return { ok: false, mensaje: 'el esquema por defecto no tiene tablas' }
  const enListado = new Set(listado)
  for (const f of candidatas) {
    const nombre = typeof f[0] === 'string' ? f[0] : ''
    if (nombre && enListado.has(nombre)) {
      return { ok: true, nombre, motivo: `por estadísticas, unas ${String(f[1])} filas` }
    }
  }
  return {
    ok: true,
    nombre: listado[0],
    motivo: `la primera del listado (ninguna tiene estadísticas entre ${FILAS_TABLA_MIN} y ${FILAS_TABLA_MAX} filas)`
  }
}
