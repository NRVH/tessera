// =============================================================================
// El REGISTRO de motores: `MOTORES`, un descriptor por cada `DbMotor`, y las preguntas sobre él
// (`descriptor`, `descriptorSql`, `esMotor`, `esMotorSql`, `etiquetasDonde`, `IDS_MOTORES`).
// `descriptor()` lanza con un motor desconocido. `src/tdb/motores.cjs` lleva su copia CJS, fijada
// por `test-motores-tdb`. Neutral y ES2020.
// Decisiones: docs/decisiones/bd/registro-motores-descriptor.md
// =============================================================================

import type { DbMotor, DbMotorSql, DbTls } from '../db-ipc.ts'
import { TLS_POR_DEFECTO } from '../db-ipc.ts'
import type {
  CampoOpcional,
  CandadoSoloLectura,
  DescriptorClaves,
  DescriptorDocumentos,
  DescriptorMotor,
  DescriptorSql,
  DestinoConexion,
  FamiliaMotor,
  FormaDestino,
  NivelBases
} from './tipos.ts'
import { destinoDeRed } from './destinoRed.ts'
import { TIPO_CAMPO_FORMA } from './definir.ts'
import { nunca } from '../nunca.ts'
import { ORACLE } from './oracle.ts'
import { POSTGRES } from './postgres.ts'
import { SQLITE } from './sqlite.ts'
import { SQLSERVER } from './sqlserver.ts'
import { MONGODB } from './mongodb.ts'
import { REDIS } from './redis.ts'

export { TIPO_CAMPO_FORMA }
export { AUTENTICACIONES, autenticacionDe, esAutenticacion, pideDominio } from './autenticacion.ts'

export type {
  CampoConexion,
  CampoDestino,
  CampoForma,
  CampoOpcional,
  NivelBases,
  CredencialesMotor,
  CampoTextoDestino,
  CampoValidable,
  CandadoSoloLectura,
  CapacidadesCatalogo,
  CapacidadesConexion,
  CapacidadesSesion,
  CapacidadesSql,
  CapacidadesClaves,
  CapacidadesDocumentos,
  ConexionDeclarada,
  DeclaracionMotor,
  DescriptorClaves,
  DescriptorDocumentos,
  DescriptorMotor,
  DescriptorSql,
  FamiliaMotor,
  DestinoConexion,
  DestinoValidable,
  FormaDestino,
  FormaPaginado,
  FormateadorMotor,
  GrupoExcluyenteDeclarado,
  GrupoExcluyenteDestino,
  IdentidadSinPk,
  PaginadoMotor,
  ParametrosFormateador
} from './tipos.ts'

/**
 * El registro. El ORDEN de las claves es el del selector de motor del formulario. Cada
 * clave lleva el descriptor de SU motor (`DescriptorMotor<M>`): el `id` y el dialecto de
 * `postgres` no pueden ser los de otro (la invariante dialecto = motor).
 */
export const MOTORES: { readonly [M in DbMotor]: DescriptorMotor<M> } = {
  oracle: ORACLE,
  postgres: POSTGRES,
  sqlite: SQLITE,
  sqlserver: SQLSERVER,
  mongodb: MONGODB,
  redis: REDIS
}

/** Los ids de los motores que esta versión conoce, en el orden de `MOTORES`. */
export const IDS_MOTORES: readonly DbMotor[] = Object.keys(MOTORES) as DbMotor[]

/** ¿Es el id de un motor que esta versión conoce? (`hasOwnProperty`, no `in`). */
export function esMotor(x: unknown): x is DbMotor {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(MOTORES, x)
}

/** El descriptor de un motor. Lanza si no está en el registro. */
export function descriptor(motor: DbMotor): DescriptorMotor {
  if (!esMotor(motor)) throw new Error(`Motor desconocido: "${String(motor)}".`)
  return MOTORES[motor]
}

/** La familia de un motor del registro (lanza con uno desconocido, como `descriptor`). */
export function familiaDe(motor: DbMotor): FamiliaMotor {
  return descriptor(motor).familia
}

/**
 * ¿Es el id de un motor SQL del registro? Un `switch` con `nunca` sobre la familia,
 * no un `=== 'sql'` suelto (la guardia lo exige): una familia nueva tiene que decidir aquí.
 */
export function esMotorSql(x: unknown): x is DbMotorSql {
  if (!esMotor(x)) return false
  const f = MOTORES[x].familia
  switch (f) {
    case 'sql':
      return true
    case 'documentos':
    case 'claves':
      return false
    default:
      return nunca(f, 'esMotorSql')
  }
}

/**
 * El descriptor de un motor SQL, para los caminos que SOLO existen en SQL (la
 * consola SQL, la rejilla, el catálogo de esquemas, `Enviar` por DML). LANZA con un motor de
 * otra familia en vez de devolver algo que no es suyo: si llega aquí un MongoDB, el fallo
 * está en quien lo mandó por el camino SQL, y se dice en voz alta (ver «FAMILIAS» en tipos.ts).
 */
export function descriptorSql(motor: DbMotor): DescriptorSql {
  if (!esMotorSql(motor)) {
    throw new Error(esMotor(motor) ? `${MOTORES[motor].etiqueta} no es un motor SQL.` : `Motor desconocido: "${String(motor)}".`)
  }
  return MOTORES[motor]
}

/** Los ids de los motores SQL, en el orden de `MOTORES`. */
export const IDS_MOTORES_SQL: readonly DbMotorSql[] = IDS_MOTORES.filter(esMotorSql)

/**
 * Una tabla por motor derivada del registro: `porMotor((d) => d.etiqueta)`. Es como se
 * construyen las tablas por motor del renderer. Lo que solo tiene sentido en SQL se deriva
 * con `porMotorSql`.
 */
export function porMotor<T>(f: (d: DescriptorMotor) => T): Readonly<Record<DbMotor, T>> {
  const salida = {} as Record<DbMotor, T>
  for (const id of IDS_MOTORES) salida[id] = f(MOTORES[id])
  return salida
}

/** Como `porMotor`, solo con los motores SQL: `porMotorSql((d) => d.catalogo.carpetas)`. */
export function porMotorSql<T>(f: (d: DescriptorSql) => T): Readonly<Record<DbMotorSql, T>> {
  const salida = {} as Record<DbMotorSql, T>
  for (const id of IDS_MOTORES_SQL) salida[id] = f(MOTORES[id])
  return salida
}

/**
 * Quién impone el solo lectura en un motor de CUALQUIER familia: en SQL es
 * `sesion.candadoSoloLectura`; en documentos y claves, el de su grupo ('listaBlanca').
 */
export function candadoSoloLecturaDe(d: DescriptorMotor): CandadoSoloLectura {
  switch (d.familia) {
    case 'sql':
      return d.sesion.candadoSoloLectura
    case 'documentos':
      return d.documentos.candadoSoloLectura
    case 'claves':
      return d.claves.candadoSoloLectura
    default:
      return nunca(d, 'candadoSoloLecturaDe')
  }
}

/** Nombre del producto («PostgreSQL») o, si el motor no se conoce, el id tal cual. */
export function etiquetaMotor(motor: string): string {
  return esMotor(motor) ? MOTORES[motor].etiqueta : motor
}

/** Una lista para una frase: «A», «A y B», «A, B y C»; '' sin ninguno. */
export function listaLegible(nombres: readonly string[]): string {
  if (nombres.length <= 1) return nombres.join('')
  return nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1]
}

/**
 * Las etiquetas de los motores que cumplen `cumple`, en el orden del registro, escritas
 * como lista (`listaLegible`): «Oracle», «Oracle y SQLite»; '' si ninguno. Para los
 * mensajes que dicen qué motores tienen algo.
 */
export function etiquetasDonde(cumple: (d: DescriptorMotor) => boolean): string {
  return listaLegible(IDS_MOTORES.filter((m) => cumple(MOTORES[m])).map((m) => MOTORES[m].etiqueta))
}

/** Como `etiquetasDonde`, entre los motores SQL («ROWID solo existe en Oracle y SQLite.»). */
export function etiquetasSqlDonde(cumple: (d: DescriptorSql) => boolean): string {
  return listaLegible(IDS_MOTORES_SQL.filter((m) => cumple(MOTORES[m])).map((m) => MOTORES[m].etiqueta))
}

/**
 * ¿Pide el motor usuario y contraseña? Un `switch` que cierra con `nunca` y no un
 * `=== 'usuarioClave'` suelto (la guardia lo exige): la autenticación integrada de SQL
 * Server será un tercer valor, y cada sitio que pregunte tendrá que decidir.
 */
export function pideUsuarioYClave(d: DescriptorMotor): boolean {
  const c = d.conexion.credenciales
  switch (c) {
    case 'usuarioClave':
      return true
    case 'ninguna':
      return false
    default:
      return nunca(c, 'pideUsuarioYClave')
  }
}

/**
 * ¿Es de la familia de DOCUMENTOS? Con `switch` y `nunca`, no un
 * `=== 'documentos'` suelto (la guardia lo exige); estrecha el tipo para `tieneNivelBases`.
 */
export function esDeDocumentos(d: DescriptorMotor): d is DescriptorDocumentos {
  switch (d.familia) {
    case 'documentos':
      return true
    case 'sql':
    case 'claves':
      return false
    default:
      return nunca(d, 'esDeDocumentos')
  }
}

/**
 * ¿Es de la familia de CLAVES? El gemelo de `esDeDocumentos`, por lo mismo.
 */
export function esDeClaves(d: DescriptorMotor): d is DescriptorClaves {
  switch (d.familia) {
    case 'claves':
      return true
    case 'sql':
    case 'documentos':
      return false
    default:
      return nunca(d, 'esDeClaves')
  }
}

/**
 * La extensión del ARCHIVO de consola de un motor, o null si su familia no tiene consola:
 * `.sql` en SQL, `.js` en documentos (el lenguaje de mongosh, y así el agente del espacio de
 * datos la lee como lo que es) y `.redis` en claves (comandos de redis-cli, uno por línea).
 * Es también el «¿tiene consola?» del árbol y de `CONSOLAS_CREAR`.
 * El `null` se conserva en el tipo para la próxima familia que no tenga consola.
 */
export function extensionConsola(d: DescriptorMotor): '.sql' | '.js' | '.redis' | null {
  switch (d.familia) {
    case 'sql':
      return '.sql'
    case 'documentos':
      return '.js'
    case 'claves':
      return '.redis'
    default:
      return nunca(d, 'extensionConsola')
  }
}

/**
 * ¿Empieza el árbol de ESTA conexión en un nivel «Bases»? (ver `NivelBases`): solo
 * si su motor lo tiene ('sinBaseFija') y la conexión no fija una base. Un `switch` con
 * `nunca`, no un `=== 'sinBaseFija'` suelto (la guardia lo exige).
 */
export function tieneNivelBases(d: DescriptorSql | DescriptorDocumentos, c: { database?: string | null }): boolean {
  const n = nivelBasesDe(d)
  switch (n) {
    case 'ninguno':
      return false
    case 'sinBaseFija':
      return !(typeof c.database === 'string' && c.database.trim() !== '')
    default:
      return nunca(n, 'tieneNivelBases')
  }
}

/**
 * El nivel «Bases» de un motor que lo tiene: SQL (su catálogo) o documentos
 * (MongoDB, el mismo árbol híbrido que SQL Server, con el valor en SU grupo).
 */
function nivelBasesDe(d: DescriptorSql | DescriptorDocumentos): NivelBases {
  switch (d.familia) {
    case 'sql':
      return d.catalogo.nivelBases
    case 'documentos':
      return d.documentos.nivelBases
    default:
      return nunca(d, 'nivelBasesDe')
  }
}

/** ¿Usa el motor este campo sin exigirlo? (`conexion.opcionales`). */
export function usaOpcional(d: DescriptorMotor, campo: CampoOpcional): boolean {
  return d.conexion.opcionales.indexOf(campo) >= 0
}

/**
 * El cifrado EFECTIVO de una conexión: el guardado o, sin él, el del
 * motor (`conexion.tlsPorDefecto`) y, sin ese, `TLS_POR_DEFECTO`. El ÚNICO sitio que decide
 * el valor por defecto en TS (el formulario y el main); `tdb` lleva su copia en la fila del
 * motor de `motores.cjs` (`tlsPorDefecto`), fijada por el test de paridad.
 */
export function tlsDeConexion(d: DescriptorMotor, c: { tls?: DbTls | null }): DbTls {
  const t = c.tls ?? d.conexion.tlsPorDefecto ?? TLS_POR_DEFECTO
  return { cifrar: t.cifrar, confiarCertificado: t.confiarCertificado }
}

/**
 * ¿Tiene una entrada CRUDA del registro (el JSON tal cual) la forma que su motor exige en
 * disco? El motor tiene que ser uno del registro y cada campo de su `conexion.forma`
 * (host y puerto; el archivo en SQLite) tiene que llevar su tipo (`TIPO_CAMPO_FORMA`). Es
 * la mitad POR MOTOR de `tieneFormaConocida` (main) y `formaConocida` (`tdb`, con su
 * copia en `motores.cjs`); la otra mitad (id, perfil y alias de texto) es común y la
 * ponen ellos.
 */
export function tieneFormaDelMotor(c: Record<string, unknown>): boolean {
  if (!esMotor(c.motor)) return false
  return MOTORES[c.motor].conexion.forma.every((campo) => typeof c[campo] === TIPO_CAMPO_FORMA[campo])
}

/**
 * El destino legible de una conexión (sin secreto), en la forma pedida: la de su motor
 * o, si el motor no se conoce (una ajena), la de un motor de red, que es lo que traen
 * los registros de hoy. Sustituye a las cinco copias a mano (ver `destinoRed.ts`).
 */
export function destinoLegible(c: DestinoConexion, forma: FormaDestino = 'completo'): string {
  return esMotor(c.motor) ? MOTORES[c.motor].conexion.destinoLegible(c, forma) : destinoDeRed(c, forma)
}
